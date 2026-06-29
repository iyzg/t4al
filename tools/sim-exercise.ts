// One-shot sim to exercise the live dashboard + prove description gating.
// Connects the 3 demo teams, drops map positions, generates a spread of
// events, and prints proof that a player's game:state withholds descriptions
// while team:state reveals them on start (and clears on abandon).
//
//   npx tsx tools/sim-exercise.ts
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'crypto';
import fs from 'fs';

const HOST = 'http://localhost:3001';
const API = `${HOST}/api`;
const gameId = fs.readFileSync('/tmp/local_game', 'utf8').trim();
const adminCode = fs.readFileSync('/tmp/local_admin', 'utf8').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const j = (p: string, opts?: any) => fetch(`${API}${p}`, opts).then((r) => r.json());

type Conn = { socket: Socket; deviceId: string; team: any; cap: { game: any; team: any } };

async function connect(team: any): Promise<Conn> {
  const deviceId = `sim-${randomUUID()}`;
  const socket = io(HOST, { transports: ['websocket'] });
  const cap = { game: null as any, team: null as any };
  socket.on('game:state', (d) => { cap.game = d; });
  socket.on('team:state', (d) => { cap.team = d; });
  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      socket.emit('game:join', { gameId, teamId: team.id, deviceId });
      setTimeout(resolve, 700);
    });
  });
  return { socket, deviceId, team, cap };
}
const ack = (c: Conn, ev: string, payload: any) =>
  new Promise<any>((res) => c.socket.emit(ev, payload, res));
const ping = (c: Conn, ch: any) =>
  c.socket.emit('location:update', { deviceId: c.deviceId, teamId: c.team.id, lat: ch.lat, lng: ch.lng });

async function main() {
  const teams = await j(`/games/${gameId}/teams`);
  const chs = await j(`/games/${gameId}/challenges`, { headers: { 'x-admin-code': adminCode } });
  const team = (n: string) => teams.find((t: any) => t.name.toLowerCase().includes(n));
  const chal = (n: string) => chs.find((c: any) => c.name.toLowerCase().includes(n.toLowerCase()));

  const red = await connect(team('red'));
  const blue = await connect(team('blue'));
  const green = await connect(team('green'));

  // Drop team dots near three challenges.
  ping(red, chal('Street Musician')); ping(blue, chal('Bean')); ping(green, chal('Free Fry'));

  // ── Description-gating proof (as Blue) ────────────────────────────────
  console.log('\n════════ DESCRIPTION-GATING PROOF (player = Blue Crew) ════════');
  console.log('game:state descriptions a player receives (should all be ""):');
  for (const c of blue.cap.game?.challenges ?? [])
    console.log(`   ${String(c.name).padEnd(22)} ${JSON.stringify(c.description)}`);

  const bean = chal('Bean');
  const startAck = await ack(blue, 'challenge:start', { challengeId: bean.id, teamId: blue.team.id });
  await sleep(400);
  console.log(`\n▶ Blue STARTS "${bean.name}" → ${JSON.stringify(startAck)}`);
  console.log(`   team:state.activeChallengeDescription = ${JSON.stringify(blue.cap.team?.activeChallengeDescription)}`);

  await ack(blue, 'challenge:abandon', { challengeId: bean.id, teamId: blue.team.id });
  await sleep(400);
  console.log(`✗ Blue ABANDONS "${bean.name}"`);
  console.log(`   team:state.activeChallengeDescription = ${JSON.stringify(blue.cap.team?.activeChallengeDescription)}  (should be null)`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Activity for the live dashboard ───────────────────────────────────
  const street = chal('Street Musician');
  await ack(red, 'challenge:start', { challengeId: street.id, teamId: red.team.id });
  await sleep(250);
  await ack(red, 'challenge:complete', { challengeId: street.id, teamId: red.team.id });
  console.log(`Red Rovers CLAIMED "${street.name}" (+${street.tokens})`);

  const freefry = chal('Free Fry');
  await ack(green, 'challenge:start', { challengeId: freefry.id, teamId: green.team.id });
  console.log(`Green Machine STARTED "${freefry.name}" (left active)`);

  // Hold connections so the admin position broadcast (5s) paints dots a few times.
  console.log('\nholding ~16s so team dots broadcast to the admin map…');
  for (let i = 0; i < 6; i++) {
    ping(red, chal('Street Musician')); ping(blue, chal('Bean')); ping(green, chal('Free Fry'));
    await sleep(2700);
  }

  red.socket.disconnect(); blue.socket.disconnect(); green.socket.disconnect();
  console.log('sim done.');
  process.exit(0);
}
main().catch((e) => { console.error('[sim]', e); process.exit(1); });
