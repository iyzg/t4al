import { test, expect, Page, BrowserContext } from '@playwright/test';
import * as path from 'path';

const API = 'http://localhost:3001/api';
const SS = path.join(__dirname, 'screenshots');

async function api(method: string, p: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${p}`, opts);
  return { status: res.status, data: await res.json() };
}

async function ss(page: Page, name: string) {
  await page.screenshot({ path: path.join(SS, `${name}.png`), fullPage: true });
}

async function joinAsTeam(ctx: BrowserContext, gameId: string, teamId: string, color: string, lat: number, lng: number) {
  await ctx.grantPermissions(['geolocation']);
  await ctx.setGeolocation({ latitude: lat, longitude: lng });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/join');
  await page.evaluate(({ gid, tid, tc }) => {
    sessionStorage.setItem('t4al_identity', JSON.stringify({ gameId: gid, teamId: tid, teamColor: tc }));
  }, { gid: gameId, tid: teamId, tc: color });
  await page.goto(`http://localhost:5173/game/${gameId}`);
  return page;
}

// ═══════════════════════════════════════════════════════════════
// STATE MATRIX: Test every game state from every perspective
// ═══════════════════════════════════════════════════════════════

test.describe('Game State Matrix', () => {

  // ── LOBBY STATE ──
  test('LOBBY: admin sees empty game, player sees waiting', async ({ browser }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Lobby' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Waiters', color: '#e74c3c' });

    // Admin view
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`http://localhost:5173/game/${game.id}/admin`);
    await expect(adminPage.getByText('LOBBY', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(adminPage.locator('text=Waiters')).toBeVisible();
    await ss(adminPage, 'matrix-01-lobby-admin');

    // Player view
    const playerCtx = await browser.newContext({
      geolocation: { latitude: 41.88, longitude: -87.62 },
      permissions: ['geolocation'],
    });
    const playerPage = await joinAsTeam(playerCtx, game.id, team.id, '#e74c3c', 41.88, -87.62);
    await playerPage.waitForTimeout(2000);
    await expect(playerPage.locator('text=Waiting for game to start')).toBeVisible({ timeout: 5000 });
    await ss(playerPage, 'matrix-02-lobby-player');

    await adminCtx.close();
    await playerCtx.close();
  });

  // ── ACTIVE STATE: challenges spawned ──
  test('ACTIVE: admin sees challenges, players see pins on leaderboard', async ({ browser }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Active' });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Alphas', color: '#e74c3c' });
    const { data: t2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Betas', color: '#3498db' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Millennium Park', description: 'Go to the park', points: 200,
      lat: 41.8826, lng: -87.6226,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'Visit the museum', points: 300,
      lat: 41.8796, lng: -87.6237,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000)); // wait for spawns

    // Admin sees active challenges
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`http://localhost:5173/game/${game.id}/admin`);
    await expect(adminPage.getByText('ACTIVE', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(adminPage.locator('text=[active]').first()).toBeVisible({ timeout: 5000 });
    await ss(adminPage, 'matrix-03-active-admin-challenges');

    // Player 1 sees leaderboard with both teams
    const p1Ctx = await browser.newContext({
      geolocation: { latitude: 41.8826, longitude: -87.6226 },
      permissions: ['geolocation'],
    });
    const p1 = await joinAsTeam(p1Ctx, game.id, t1.id, '#e74c3c', 41.8826, -87.6226);
    await p1.waitForTimeout(3000);
    await expect(p1.locator('text=Alphas')).toBeVisible({ timeout: 5000 });
    await expect(p1.locator('text=Betas')).toBeVisible({ timeout: 5000 });
    await ss(p1, 'matrix-04-active-player1-sees-leaderboard');

    // Player 2 sees the same
    const p2Ctx = await browser.newContext({
      geolocation: { latitude: 41.8796, longitude: -87.6237 },
      permissions: ['geolocation'],
    });
    const p2 = await joinAsTeam(p2Ctx, game.id, t2.id, '#3498db', 41.8796, -87.6237);
    await p2.waitForTimeout(3000);
    await expect(p2.locator('text=Alphas')).toBeVisible({ timeout: 5000 });
    await ss(p2, 'matrix-05-active-player2-sees-leaderboard');

    await adminCtx.close();
    await p1Ctx.close();
    await p2Ctx.close();
  });

  // ── CLAIM FLOW: one team claims, other sees update ──
  test('CLAIM: team claims challenge, other team sees leaderboard update', async ({ browser }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Claim' });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Claimers', color: '#e74c3c' });
    const { data: t2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Watchers', color: '#3498db' });
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Claim Target', description: 'Claim me', points: 500,
      lat: 41.8827, lng: -87.6233,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Both teams join
    const ctx1 = await browser.newContext({
      geolocation: { latitude: 41.8827, longitude: -87.6233 },
      permissions: ['geolocation'],
    });
    const ctx2 = await browser.newContext({
      geolocation: { latitude: 41.88, longitude: -87.62 },
      permissions: ['geolocation'],
    });
    const p1 = await joinAsTeam(ctx1, game.id, t1.id, '#e74c3c', 41.8827, -87.6233);
    const p2 = await joinAsTeam(ctx2, game.id, t2.id, '#3498db', 41.88, -87.62);
    await p1.waitForTimeout(3000);
    await p2.waitForTimeout(2000);

    await ss(p1, 'matrix-06-claim-before-p1');
    await ss(p2, 'matrix-07-claim-before-p2');

    // Team 1 claims via API
    await api('POST', `/challenges/${c1.id}/claim`, { teamId: t1.id });
    await p1.waitForTimeout(3000);
    await p2.waitForTimeout(2000);

    await ss(p1, 'matrix-08-claim-after-p1');
    await ss(p2, 'matrix-09-claim-after-p2');

    // Verify leaderboard updated via socket on the other player's page
    await expect(p2.locator('text=500')).toBeVisible({ timeout: 5000 });

    await ctx1.close();
    await ctx2.close();
  });

  // ── ENDED STATE ──
  test('ENDED: admin ends game, all players redirect to end page', async ({ browser }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Ended' });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Enders', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/start`);

    const ctx = await browser.newContext({
      geolocation: { latitude: 41.88, longitude: -87.62 },
      permissions: ['geolocation'],
    });
    const p1 = await joinAsTeam(ctx, game.id, t1.id, '#e74c3c', 41.88, -87.62);
    await p1.waitForTimeout(3000);
    await ss(p1, 'matrix-10-ended-before');

    // Admin ends game
    await api('POST', `/games/${game.id}/end`);

    // Player should redirect to end page
    await expect(p1).toHaveURL(new RegExp(`/game/${game.id}/end`), { timeout: 10000 });
    await ss(p1, 'matrix-11-ended-after-redirect');
    await expect(p1.locator('text=Final Standings')).toBeVisible();
    await expect(p1.locator('text=Enders')).toBeVisible();

    await ctx.close();
  });

  // ── EMPTY GAME: no teams, no challenges ──
  test('EMPTY: admin panel with no teams or challenges', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Empty' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=No teams yet')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Challenges (0)')).toBeVisible();
    await ss(page, 'matrix-12-empty-admin');
  });

  // ── MANY TEAMS: 7 teams fill all colors ──
  test('MANY TEAMS: 7 teams fill all colors, leaderboard shows all', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Full' });
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];
    for (let i = 0; i < 7; i++) {
      await api('POST', `/games/${game.id}/teams`, { name: `Team ${i + 1}`, color: colors[i] });
    }
    await api('POST', `/games/${game.id}/start`);

    // Admin should see all 7 teams
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Teams (7)')).toBeVisible({ timeout: 5000 });
    await ss(page, 'matrix-13-many-teams-admin');
  });

  // ── MANY CHALLENGES: 10 challenges ──
  test('MANY CHALLENGES: 10 challenges listed in admin', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'State: Many Challenges' });
    for (let i = 0; i < 10; i++) {
      await api('POST', `/games/${game.id}/challenges`, {
        name: `Challenge ${i + 1}`, description: `Desc ${i}`, points: (i + 1) * 50,
        lat: 41.88 + i * 0.001, lng: -87.62,
      });
    }

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Challenges (10)')).toBeVisible({ timeout: 5000 });
    await ss(page, 'matrix-14-many-challenges-admin');
  });
});
