import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, p: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${p}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Admin Panel Live Updates', () => {
  test('new team appears on admin panel after joining', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Admin Live Team' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=No teams yet')).toBeVisible({ timeout: 5000 });

    // Create a team via API
    await api('POST', `/games/${game.id}/teams`, { name: 'New Joiners', color: '#e74c3c' });

    // Admin panel should show the team on next poll (5s)
    await expect(page.locator('text=New Joiners')).toBeVisible({ timeout: 10000 });
  });

  test('challenge count updates after adding challenges', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Admin Live Challenges' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Challenges (0)')).toBeVisible({ timeout: 5000 });

    // Create challenges via API
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.62,
    });

    // Should show 2 challenges after poll
    await expect(page.locator('text=Challenges (2)')).toBeVisible({ timeout: 10000 });
  });

  test('score updates after challenge claim', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Admin Live Score' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Scorers', color: '#e74c3c' });
    const { data: chal } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Score Me', description: 'D', points: 777, lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000)); // wait for spawn

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=0 pts')).toBeVisible({ timeout: 5000 });

    // Claim via API
    await api('POST', `/challenges/${chal.id}/claim`, { teamId: team.id });

    // Score should update on poll
    // The score appears in the team row; use a more specific selector
    await expect(page.locator('text=777 pts').first()).toBeVisible({ timeout: 10000 });
  });

  test('event log shows claim event after challenge claim', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Admin Event Claim' });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Claimers', color: '#e74c3c' });
    const { data: chal } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Log Me', description: 'D', points: 500, lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Game started')).toBeVisible({ timeout: 10000 });

    // Claim
    await api('POST', `/challenges/${chal.id}/claim`, { teamId: team.id });

    // Event log should show claim (not from socket — from next poll of events endpoint)
    // The REST claim endpoint logs events now
    await expect(page.locator('text=claimed')).toBeVisible({ timeout: 10000 });
  });
});
