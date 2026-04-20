import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Admin Settings', () => {
  test('admin can update queue settings before game starts', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Pre-start Settings', activeChallengeCount: 3, challengeExpireMinutes: 10,
    });
    const { status, data } = await api('PUT', `/games/${game.id}`, {
      activeChallengeCount: 5, challengeExpireMinutes: 20,
    });
    expect(status).toBe(200);
    expect(data.active_challenge_count).toBe(5);
    expect(data.challenge_expire_minutes).toBe(20);
  });

  test('admin can update queue settings during active game', async () => {
    const { data: game } = await api('POST', '/games', {
      name: 'Mid-game Settings', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/start`);
    // Should still be able to update K and expire time
    const { status, data } = await api('PUT', `/games/${game.id}`, {
      activeChallengeCount: 5,
    });
    expect(status).toBe(200);
    expect(data.active_challenge_count).toBe(5);
  });

  test('edit challenges link goes to setup page', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Link Test' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Edit Challenges')).toBeVisible({ timeout: 5000 });
    const href = await page.locator('a:has-text("Edit Challenges")').getAttribute('href');
    expect(href).toBe(`/game/${game.id}/admin/setup`);
  });

  test('back to admin link goes to admin page', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Back Link Test' });
    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Back to Admin Panel')).toBeVisible({ timeout: 5000 });
    const href = await page.locator('a:has-text("Back to Admin Panel")').getAttribute('href');
    expect(href).toBe(`/game/${game.id}/admin`);
  });

  test('start game button disabled after game starts', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Button State' });
    await api('POST', `/games/${game.id}/start`);
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.getByText('ACTIVE', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    const startBtn = page.locator('button:has-text("Start Game")');
    await expect(startBtn).toBeDisabled();
  });

  test('end game button enabled only when active', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'End Button State' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=LOBBY')).toBeVisible({ timeout: 5000 });
    const endBtn = page.locator('button:has-text("End Game")');
    await expect(endBtn).toBeDisabled();
  });
});
