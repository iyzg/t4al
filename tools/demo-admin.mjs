// Demo seeder for poking around the redesigned admin pages.
//
// Prereq: the dev stack is running (`npm run dev` from the repo root, which
// starts the server on :3001 and the client on :5173).
//
// Usage:  node tools/demo-admin.mjs            (or: npm run demo:admin)
//
// Creates a fresh game with a spread of challenges + a few teams, records it
// as the active sandbox game (/tmp/local_game, /tmp/local_admin — same files
// the puppet CLI reads), and prints a menu of URLs + the codes you need to
// reach each admin page.
import fs from 'fs';

const HOST = process.env.DEMO_HOST ?? 'http://localhost:3001';
const CLIENT = process.env.DEMO_CLIENT ?? 'http://localhost:5173';
const API = `${HOST}/api`;

// Map center (matches mapStyle.CHICAGO_CENTER) so challenges land in view.
const [CLNG, CLAT] = [-87.624078, 41.872402];
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function main() {
  // Fail fast with a friendly message if the server isn't up.
  try {
    await fetch(`${API}/games`);
  } catch {
    console.error(`\n✗ Can't reach the server at ${HOST}.`);
    console.error(`  Start the stack first:  npm run dev\n`);
    process.exit(1);
  }

  const game = await j(await fetch(`${API}/games`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Demo Hunt', durationMinutes: 60,
      activeChallengeCount: 3, challengeExpireMinutes: 10, startingTokens: 50,
    }),
  }));
  if (!game?.id) { console.error('Failed to create game:', game); process.exit(1); }

  const H = { 'Content-Type': 'application/json', 'x-admin-code': game.adminCode };
  const challenges = [
    { name: 'Free Fry Friday',     description: 'Convince a restaurant to give you free fries — no apps, no deals, you must grovel.', type: 'normal',   tokens: 70,                          proximityMeters: 100, lat: CLAT + 0.0016, lng: CLNG + 0.0014 },
    { name: 'Pet Many Dogs',       description: 'Pet (and compliment) as many dogs as you can in 5 minutes.',                          type: 'variable', tokensPerUnit: 3, unitLabel: 'dog',   proximityMeters: 120, lat: CLAT - 0.0014, lng: CLNG + 0.0022 },
    { name: 'Guesstimate a KM',    description: 'Without any tools, walk as close to 1 km as you can from here.',                       type: 'wager',                                         proximityMeters: 150, lat: CLAT + 0.0018, lng: CLNG - 0.0020 },
    { name: 'Bean Selfie',         description: 'Take a team selfie reflected in Cloud Gate.',                                           type: 'normal',   tokens: 40,                          proximityMeters: 80,  lat: CLAT - 0.0020, lng: CLNG - 0.0012 },
    { name: 'Street Musician Tip', description: 'Tip a street musician and request a song.',                                            type: 'normal',   tokens: 30,                          proximityMeters: 90,  lat: CLAT + 0.0026, lng: CLNG + 0.0028 },
  ];
  for (const c of challenges) {
    await fetch(`${API}/games/${game.id}/challenges`, { method: 'POST', headers: H, body: JSON.stringify(c) });
  }

  for (const t of [
    { name: 'Red Rovers',    color: '#C41230' },
    { name: 'Blue Crew',     color: '#0082C8' },
    { name: 'Green Machine', color: '#008751' },
  ]) {
    await fetch(`${API}/games/${game.id}/teams`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t),
    });
  }

  // Record as the active sandbox game (puppet CLI reads these).
  fs.writeFileSync('/tmp/local_game', game.id);
  fs.writeFileSync('/tmp/local_admin', game.adminCode);

  const snippet = `localStorage.setItem('adminCode:${game.id}','${game.adminCode}')`;
  const line = '─'.repeat(64);
  console.log(`
${line}
  Demo game ready — "${game.name}"
${line}

  Join code:   ${game.joinCode}
  Admin code:  ${game.adminCode}

  PAGES TO POKE AROUND
  ────────────────────
  Create game   ${CLIENT}/
                  (fill it in + submit to see the "game created" screen)

  Admin login   ${CLIENT}/admin
                  (enter the join + admin code above → lands in Setup)

  Challenge setup
                ${CLIENT}/game/${game.id}/admin/setup
  Live dashboard
                ${CLIENT}/game/${game.id}/admin

  The Setup / Live links need the admin code in this browser's localStorage.
  Two ways to get there:
    • Easiest: open ${CLIENT}/admin and paste the codes above (one time), or
    • Shortcut: open ${CLIENT} , then in the DevTools console run:
        ${snippet}
      …then visit the Setup / Live links directly.

  On the Live page, hit "Start game" to watch it go active (countdown,
  hold-to-end, hold-to-expire, queue advancing).
${line}
`);
}

main();
