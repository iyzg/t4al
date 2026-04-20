import { test, expect, Page } from '@playwright/test';
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

test.describe('Live Update Verification', () => {

  test('admin panel updates when game starts (via external API call)', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Live: Admin Start' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.getByText('LOBBY', { exact: true })).toBeVisible({ timeout: 5000 });
    await ss(page, 'live-01-admin-before-start');

    // Start game externally
    await api('POST', `/games/${game.id}/start`);

    // Admin panel should update on next poll (5s)
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible({ timeout: 10000 });
    await ss(page, 'live-02-admin-after-start');
  });

  test('admin panel shows new team after creation', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Live: New Team' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=No teams yet')).toBeVisible({ timeout: 5000 });

    // Create team externally
    await api('POST', `/games/${game.id}/teams`, { name: 'Late Arrivals', color: '#e74c3c' });

    // Should appear on next poll
    await expect(page.locator('text=Late Arrivals')).toBeVisible({ timeout: 10000 });
    await ss(page, 'live-03-admin-new-team');
  });

  test('admin panel shows challenge status change after activation', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Live: Spawn' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Spawn Watch', description: 'D', points: 100,
      lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await page.goto(`/game/${game.id}/admin`);

    // Should show queued
    await expect(page.locator('text=[queued]')).toBeVisible({ timeout: 5000 });

    // Start game
    await api('POST', `/games/${game.id}/start`);

    // Wait for ticker to activate + poll to update
    await expect(page.locator('text=[active]')).toBeVisible({ timeout: 20000 });
    await ss(page, 'live-04-admin-challenge-spawned');
  });

  test('admin event log updates with new events', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Live: Events' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=No events yet')).toBeVisible({ timeout: 5000 });

    // Start game
    await api('POST', `/games/${game.id}/start`);

    // Event log should show game started on next poll
    await expect(page.locator('text=Game started')).toBeVisible({ timeout: 10000 });
    await ss(page, 'live-05-admin-event-log');
  });

  test('player leaderboard updates when another team scores', async ({ browser }) => {
    const { data: game } = await api('POST', '/games', { name: 'Live: Score' });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Scorers', color: '#e74c3c' });
    const { data: t2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Observers', color: '#3498db' });
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Score Test', description: 'D', points: 777,
      lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000)); // wait for spawn

    // Observer joins
    const ctx = await browser.newContext({
      geolocation: { latitude: 41.88, longitude: -87.62 },
      permissions: ['geolocation'],
    });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173/join');
    await page.evaluate(({ gid, tid }) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify({ gameId: gid, teamId: tid, teamColor: '#3498db' }));
    }, { gid: game.id, tid: t2.id });
    await page.goto(`http://localhost:5173/game/${game.id}`);
    await page.waitForTimeout(3000);

    // Verify initial leaderboard shows 0 for both
    await expect(page.locator('text=Scorers')).toBeVisible({ timeout: 5000 });
    await ss(page, 'live-06-observer-before-score');

    // Scorer claims via REST (which now emits socket events)
    await api('POST', `/challenges/${c1.id}/claim`, { teamId: t1.id });

    // Observer should see 777 on leaderboard
    await expect(page.locator('text=777')).toBeVisible({ timeout: 5000 });
    await ss(page, 'live-07-observer-after-score');

    await ctx.close();
  });
});
