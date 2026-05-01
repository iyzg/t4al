// Puppet: act as any team via socket.io. Useful for testing live updates
// (other-team activity broadcasts) without needing multiple browsers.
//
// Usage:
//   npx tsx tools/puppet.ts <team> <action> [args...]
//
// Examples (game and team are auto-resolved from the latest active game):
//   npx tsx tools/puppet.ts Wolves start "The Bean"
//   npx tsx tools/puppet.ts Wolves complete                  # complete current active
//   npx tsx tools/puppet.ts Wolves claim "Buckingham Fountain"  # start + complete
//   npx tsx tools/puppet.ts Bears variable "Fountain Pennies" 12 # claim variable w/ count
//   npx tsx tools/puppet.ts Mantis wager "Riddle Run" 20    # start + lock wager
//   npx tsx tools/puppet.ts Mantis pass                      # complete current wager
//   npx tsx tools/puppet.ts Mantis fail                      # fail current wager
//   npx tsx tools/puppet.ts Wolves abandon
//   npx tsx tools/puppet.ts list                             # show teams + challenges
//
// Server defaults to http://localhost:3001 (override with PUPPET_HOST env).

import { io } from 'socket.io-client';
import { randomUUID } from 'crypto';

const HOST = process.env.PUPPET_HOST ?? 'http://localhost:3001';
const API  = `${HOST}/api`;

async function fetchJson<T = any>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  return r.json() as Promise<T>;
}

async function findActiveGame(): Promise<any> {
  // No "list games" endpoint; piggyback on what we have.
  // We track the dev game in /tmp/local_game (written when the user spins one up).
  const fs = await import('fs');
  const path = '/tmp/local_game';
  if (!fs.existsSync(path)) throw new Error(`No game id at ${path}. Create one first.`);
  const id = fs.readFileSync(path, 'utf-8').trim();
  const game = await fetchJson(`/games/${id}`);
  if (!game?.id) throw new Error(`Game ${id} not found`);
  return game;
}

async function listInfo(): Promise<void> {
  const game = await findActiveGame();
  const teams = await fetchJson(`/games/${game.id}/teams`);
  const fs = await import('fs');
  const adminCode = fs.readFileSync('/tmp/local_admin', 'utf-8').trim();
  const r = await fetch(`${API}/games/${game.id}/challenges`, { headers: { 'x-admin-code': adminCode } });
  const challenges = await r.json();
  console.log(`Game: ${game.name} (${game.status})`);
  console.log('\nTeams:');
  for (const t of teams) console.log(`  ${t.name.padEnd(10)} tokens=${t.tokens}  active=${t.activeChallengeId ?? '-'}`);
  console.log('\nChallenges:');
  for (const c of challenges) {
    const tag = c.type === 'normal' ? `${c.tokens}t` : c.type === 'variable' ? `${c.tokensPerUnit}/${c.unitLabel}` : 'wager';
    console.log(`  #${c.sortOrder} [${c.status.padEnd(7)}] ${c.type.padEnd(8)} ${tag.padEnd(10)} ${c.name}`);
  }
}

function findChallengeByName(challenges: any[], name: string): any | null {
  const needle = name.toLowerCase();
  return challenges.find((c) => c.name.toLowerCase().includes(needle)) ?? null;
}

async function connect(gameId: string, teamId: string) {
  const deviceId = `puppet-${randomUUID()}`;
  const socket = io(HOST, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      socket.emit('game:join', { gameId, teamId, deviceId });
      socket.once('game:state', () => resolve());
      setTimeout(() => reject(new Error('Timed out waiting for game:state')), 5000);
    });
    socket.on('connect_error', reject);
  });
  return socket;
}

function emitAck<T>(socket: any, event: string, payload: any): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function run() {
  const [, , ...rawArgs] = process.argv;
  const args = rawArgs.filter((a) => !a.startsWith('--'));

  if (args.length === 0 || args[0] === 'list') {
    await listInfo();
    process.exit(0);
  }

  const teamName = args[0];
  const action = (args[1] ?? '').toLowerCase();
  if (!action) throw new Error('Missing action. Try: list, start, complete, claim, variable, wager, pass, fail, abandon');

  const game = await findActiveGame();
  const teams = await fetchJson(`/games/${game.id}/teams`);
  const team = teams.find((t: any) => t.name.toLowerCase() === teamName.toLowerCase());
  if (!team) throw new Error(`Team "${teamName}" not found. Try: ${teams.map((t: any) => t.name).join(', ')}`);

  // Fetch challenges via admin endpoint (simpler — has full list)
  const fs = await import('fs');
  const adminCode = fs.readFileSync('/tmp/local_admin', 'utf-8').trim();
  const r = await fetch(`${API}/games/${game.id}/challenges`, { headers: { 'x-admin-code': adminCode } });
  const challenges = await r.json();

  const socket = await connect(game.id, team.id);
  console.log(`[puppet] connected as ${team.name}`);

  async function runStart(challengeName?: string) {
    if (team.activeChallengeId) {
      console.log(`[puppet] ${team.name} already on challenge ${team.activeChallengeId}; skipping start`);
      return team.activeChallengeId;
    }
    let target: any;
    if (challengeName) {
      target = findChallengeByName(challenges, challengeName);
      if (!target) throw new Error(`No challenge matching "${challengeName}"`);
    } else {
      target = challenges.find((c: any) => c.status === 'active');
      if (!target) throw new Error('No active challenge to start');
    }
    if (target.status !== 'active') throw new Error(`Challenge "${target.name}" is ${target.status}, not active`);
    const ack: any = await emitAck(socket, 'challenge:start', { challengeId: target.id, teamId: team.id });
    console.log(`[puppet] start "${target.name}" → ${JSON.stringify(ack)}`);
    if (!ack.ok) throw new Error(`start rejected: ${ack.reason}`);
    return target.id;
  }

  async function runComplete(count?: number) {
    // Refetch team to find the active challenge ID (in case we just started one)
    const teamsNow = await fetchJson(`/games/${game.id}/teams`);
    const me = teamsNow.find((t: any) => t.id === team.id);
    if (!me?.activeChallengeId) throw new Error(`${team.name} has no active challenge to complete`);
    const ack: any = await emitAck(socket, 'challenge:complete', { challengeId: me.activeChallengeId, teamId: team.id, count });
    console.log(`[puppet] complete${count != null ? ` count=${count}` : ''} → ${JSON.stringify(ack)}`);
  }

  async function runWagerSet(amount: number, challengeName?: string) {
    if (challengeName && !team.activeChallengeId) {
      await runStart(challengeName);
    }
    const teamsNow = await fetchJson(`/games/${game.id}/teams`);
    const me = teamsNow.find((t: any) => t.id === team.id);
    if (!me?.activeChallengeId) throw new Error('No active challenge for wager');
    const ack: any = await emitAck(socket, 'challenge:wager', { challengeId: me.activeChallengeId, teamId: team.id, wagerAmount: amount });
    console.log(`[puppet] wager ${amount} → ${JSON.stringify(ack)}`);
  }

  async function runFail() {
    const teamsNow = await fetchJson(`/games/${game.id}/teams`);
    const me = teamsNow.find((t: any) => t.id === team.id);
    if (!me?.activeChallengeId) throw new Error('No active challenge to fail');
    const ack: any = await emitAck(socket, 'challenge:fail', { challengeId: me.activeChallengeId, teamId: team.id });
    console.log(`[puppet] fail → ${JSON.stringify(ack)}`);
  }

  async function runAbandon() {
    const teamsNow = await fetchJson(`/games/${game.id}/teams`);
    const me = teamsNow.find((t: any) => t.id === team.id);
    if (!me?.activeChallengeId) throw new Error('No active challenge to abandon');
    const ack: any = await emitAck(socket, 'challenge:abandon', { challengeId: me.activeChallengeId, teamId: team.id });
    console.log(`[puppet] abandon → ${JSON.stringify(ack)}`);
  }

  try {
    switch (action) {
      case 'start':
        await runStart(args[2]);
        break;
      case 'complete':
        await runComplete();
        break;
      case 'claim':
        await runStart(args[2]);
        await new Promise((r) => setTimeout(r, 200));
        await runComplete();
        break;
      case 'variable': {
        const challengeName = args[2];
        const count = Number(args[3]);
        if (!challengeName || !Number.isFinite(count)) throw new Error('Usage: variable <challengeName> <count>');
        await runStart(challengeName);
        await new Promise((r) => setTimeout(r, 200));
        await runComplete(count);
        break;
      }
      case 'wager': {
        const challengeName = args[2];
        const amount = Number(args[3]);
        if (!challengeName || !Number.isFinite(amount)) throw new Error('Usage: wager <challengeName> <amount>');
        await runWagerSet(amount, challengeName);
        break;
      }
      case 'pass':
        await runComplete();
        break;
      case 'fail':
        await runFail();
        break;
      case 'abandon':
        await runAbandon();
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } finally {
    await new Promise((r) => setTimeout(r, 250)); // let any final broadcast flush
    socket.disconnect();
  }
}

run().catch((err) => {
  console.error('[puppet]', err.message ?? err);
  process.exit(1);
});
