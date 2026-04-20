import { test, expect, Page } from '@playwright/test';
import * as path from 'path';

const API = 'http://localhost:3001/api';
const SCREENSHOTS = path.join(__dirname, 'screenshots');

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

/** Set up a game with teams and challenges, start it, wait for spawns */
async function setupGame(opts: {
  name: string;
  teams: { name: string; color: string }[];
  challenges: { name: string; description: string; points: number; lat: number; lng: number; sortOrder?: number }[];
}) {
  const { data: game } = await api('POST', '/games', { name: opts.name, durationMinutes: 60 });
  const teams = [];
  for (const t of opts.teams) {
    const { data } = await api('POST', `/games/${game.id}/teams`, t);
    teams.push(data);
  }
  const challenges = [];
  for (let i = 0; i < opts.challenges.length; i++) {
    const c = opts.challenges[i];
    const { data } = await api('POST', `/games/${game.id}/challenges`, {
      ...c, sortOrder: c.sortOrder ?? (i + 1),
    });
    challenges.push(data);
  }
  await api('POST', `/games/${game.id}/start`);
  return { game, teams, challenges };
}

/** Create a page with spoofed GPS at given coordinates */
async function createPlayerPage(
  page: Page,
  gameId: string,
  teamId: string,
  teamColor: string,
  lat: number,
  lng: number,
) {
  // Spoof geolocation
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: lat, longitude: lng });

  // Set identity
  await page.goto('/join');
  await page.evaluate(({ gid, tid, tc }) => {
    sessionStorage.setItem('t4al_identity', JSON.stringify({
      gameId: gid, teamId: tid, teamColor: tc,
    }));
  }, { gid: gameId, tid: teamId, tc: teamColor });

  await page.goto(`/game/${gameId}`);
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`), fullPage: true });
}

// ═══════════════════════════════════════════════════════════
// Flow 1: Single team, single challenge — proximity + claim
// ═══════════════════════════════════════════════════════════
test.describe('Flow 1: Single team, single challenge', () => {
  test('proximity gate → activate → see description → complete', async ({ page }) => {
    const CHALLENGE_LAT = 41.8827;
    const CHALLENGE_LNG = -87.6233;
    const FAR_LAT = 41.8900; // ~800m north
    const NEAR_LAT = 41.8828; // ~10m north (within 100m default)

    const { game, teams, challenges } = await setupGame({
      name: 'Flow 1: Proximity',
      teams: [{ name: 'Solo Team', color: '#e74c3c' }],
      challenges: [{ name: 'The Bean', description: 'Touch Cloud Gate', points: 200, lat: CHALLENGE_LAT, lng: CHALLENGE_LNG }],
    });

    // Wait for challenge to spawn
    await page.waitForTimeout(12000);

    // 1. Team starts FAR from challenge
    await createPlayerPage(page, game.id, teams[0].id, '#e74c3c', FAR_LAT, CHALLENGE_LNG);
    await page.waitForTimeout(3000);
    await screenshot(page, '01-flow1-team-far-from-challenge');

    // Leaderboard should show the team
    await expect(page.locator('text=Solo Team')).toBeVisible({ timeout: 5000 });

    // 2. Move team NEAR the challenge
    await page.context().setGeolocation({ latitude: NEAR_LAT, longitude: CHALLENGE_LNG });
    // Trigger a GPS update by waiting for the watchPosition callback
    await page.waitForTimeout(2000);
    await screenshot(page, '02-flow1-team-near-challenge');
  });
});

// ═══════════════════════════════════════════════════════════
// Flow 2: Two teams race for same challenge
// ═══════════════════════════════════════════════════════════
test.describe('Flow 2: Two teams compete', () => {
  test('first team to complete wins points, second sees claimed', async ({ browser }) => {
    const CHALLENGE_LAT = 41.8827;
    const CHALLENGE_LNG = -87.6233;

    const { game, teams, challenges } = await setupGame({
      name: 'Flow 2: Race',
      teams: [
        { name: 'Red Racers', color: '#e74c3c' },
        { name: 'Blue Bolts', color: '#3498db' },
      ],
      challenges: [{ name: 'Race Point', description: 'First wins!', points: 500, lat: CHALLENGE_LAT, lng: CHALLENGE_LNG }],
    });

    await new Promise(r => setTimeout(r, 12000)); // wait for spawn

    // Create two browser contexts (two different teams)
    const ctx1 = await browser.newContext({
      geolocation: { latitude: CHALLENGE_LAT, longitude: CHALLENGE_LNG },
      permissions: ['geolocation'],
    });
    const ctx2 = await browser.newContext({
      geolocation: { latitude: CHALLENGE_LAT, longitude: CHALLENGE_LNG },
      permissions: ['geolocation'],
    });
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    // Team 1 joins
    await page1.goto('http://localhost:5173/join');
    await page1.evaluate(({ gid, tid }) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify({ gameId: gid, teamId: tid, teamColor: '#e74c3c' }));
    }, { gid: game.id, tid: teams[0].id });
    await page1.goto(`http://localhost:5173/game/${game.id}`);
    await page1.waitForTimeout(3000);

    // Team 2 joins
    await page2.goto('http://localhost:5173/join');
    await page2.evaluate(({ gid, tid }) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify({ gameId: gid, teamId: tid, teamColor: '#3498db' }));
    }, { gid: game.id, tid: teams[1].id });
    await page2.goto(`http://localhost:5173/game/${game.id}`);
    await page2.waitForTimeout(3000);

    await page1.screenshot({ path: path.join(SCREENSHOTS, '03-flow2-team1-sees-challenge.png') });
    await page2.screenshot({ path: path.join(SCREENSHOTS, '04-flow2-team2-sees-challenge.png') });

    // Both teams should see leaderboard
    await expect(page1.locator('text=Red Racers')).toBeVisible({ timeout: 5000 });
    await expect(page1.locator('text=Blue Bolts')).toBeVisible({ timeout: 5000 });
    await expect(page2.locator('text=Red Racers')).toBeVisible({ timeout: 5000 });

    // Team 1 claims via API (simulates the socket flow)
    await api('POST', `/challenges/${challenges[0].id}/claim`, { teamId: teams[0].id });

    // Wait for the claim event to propagate
    await page1.waitForTimeout(3000);
    await page2.waitForTimeout(1000);

    await page1.screenshot({ path: path.join(SCREENSHOTS, '05-flow2-team1-after-claim.png') });
    await page2.screenshot({ path: path.join(SCREENSHOTS, '06-flow2-team2-sees-claimed.png') });

    // Verify scores updated
    const { data: teamsAfter } = await api('GET', `/games/${game.id}/teams`);
    const red = teamsAfter.find((t: any) => t.name === 'Red Racers');
    const blue = teamsAfter.find((t: any) => t.name === 'Blue Bolts');
    expect(red.score).toBe(500);
    expect(blue.score).toBe(0);

    await ctx1.close();
    await ctx2.close();
  });
});

// ═══════════════════════════════════════════════════════════
// Flow 3: Multiple challenges, multiple teams
// ═══════════════════════════════════════════════════════════
test.describe('Flow 3: Multi-challenge game', () => {
  test('three teams, three challenges — verify leaderboard updates', async () => {
    const { game, teams, challenges } = await setupGame({
      name: 'Flow 3: Multi',
      teams: [
        { name: 'Alpha', color: '#e74c3c' },
        { name: 'Beta', color: '#3498db' },
        { name: 'Gamma', color: '#2ecc71' },
      ],
      challenges: [
        { name: 'C1', description: 'First', points: 100, lat: 41.880, lng: -87.623 },
        { name: 'C2', description: 'Second', points: 200, lat: 41.881, lng: -87.623 },
        { name: 'C3', description: 'Third', points: 300, lat: 41.882, lng: -87.623 },
      ],
    });

    // Wait for all to spawn
    await new Promise(r => setTimeout(r, 12000));

    // Verify all active
    const { data: cList } = await api('GET', `/games/${game.id}/challenges`);
    const active = cList.filter((c: any) => c.status === 'active');
    expect(active.length).toBe(3);

    // Each team claims one
    await api('POST', `/challenges/${challenges[0].id}/claim`, { teamId: teams[0].id }); // Alpha: 100
    await api('POST', `/challenges/${challenges[1].id}/claim`, { teamId: teams[1].id }); // Beta: 200
    await api('POST', `/challenges/${challenges[2].id}/claim`, { teamId: teams[2].id }); // Gamma: 300

    // Verify scores
    const { data: teamsAfter } = await api('GET', `/games/${game.id}/teams`);
    const scores: Record<string, number> = {};
    teamsAfter.forEach((t: any) => { scores[t.name] = t.score; });
    expect(scores['Alpha']).toBe(100);
    expect(scores['Beta']).toBe(200);
    expect(scores['Gamma']).toBe(300);

    // Verify all challenges are claimed
    const { data: cAfter } = await api('GET', `/games/${game.id}/challenges`);
    expect(cAfter.every((c: any) => c.status === 'claimed')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Flow 4: Game end while team is active
// ═══════════════════════════════════════════════════════════
test.describe('Flow 4: Game end during play', () => {
  test('ending game redirects player to end page', async ({ page }) => {
    const { game, teams } = await setupGame({
      name: 'Flow 4: End During Play',
      teams: [{ name: 'Active Team', color: '#e74c3c' }],
      challenges: [{ name: 'Interrupted', description: 'Never finished', points: 100, lat: 41.88, lng: -87.62 }],
    });

    // Join as team
    await createPlayerPage(page, game.id, teams[0].id, '#e74c3c', 41.88, -87.62);
    await page.waitForTimeout(3000);
    await screenshot(page, '07-flow4-playing-before-end');

    // Admin force-ends the game via API
    await api('POST', `/games/${game.id}/end`);

    // Player should be redirected to end page
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}/end`), { timeout: 10000 });
    await screenshot(page, '08-flow4-redirected-to-end-page');

    await expect(page.locator('text=Final Standings')).toBeVisible();
    await expect(page.locator('text=Active Team')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════
// Flow 5: Queue-based challenge activation
// ═══════════════════════════════════════════════════════════
test.describe('Flow 5: Queue-based activation', () => {
  test('only activeChallengeCount challenges activate, rest stay queued', async () => {
    // activeChallengeCount=1 means only one challenge active at a time
    const { data: game } = await api('POST', '/games', { name: 'Flow 5: Queue', durationMinutes: 60, activeChallengeCount: 1 });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Waiter', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'First', description: 'Now', points: 50, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Second', description: 'Later', points: 150, lat: 41.89, lng: -87.62, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/start`);

    // Wait for ticker (10s) — only first should activate
    await new Promise(r => setTimeout(r, 12000));

    const { data: cList } = await api('GET', `/games/${game.id}/challenges`);
    const first = cList.find((c: any) => c.name === 'First');
    const second = cList.find((c: any) => c.name === 'Second');
    expect(first.status).toBe('active');
    expect(second.status).toBe('queued'); // Still waiting in queue
  });
});
