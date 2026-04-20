import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Admin Setup - Challenge Order Panel', () => {
  test('challenge order button shows challenge count', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Order Count Test' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621,
    });

    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Click anywhere')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Challenge Order (2)")')).toBeVisible();
  });

  test('clicking challenge order opens the panel', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Order Panel Test' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Alpha', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Beta', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    await page.goto(`/game/${game.id}/admin/setup`);
    await page.click('button:has-text("Challenge Order")');

    // Panel should show both challenges in order
    await expect(page.locator('h3:has-text("Challenge Order")')).toBeVisible();
    await expect(page.locator('text=Alpha')).toBeVisible();
    await expect(page.locator('text=Beta')).toBeVisible();
    await expect(page.locator('text=Challenges at the top appear first')).toBeVisible();
  });

  test('empty order panel shows message', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Empty Order Test' });

    await page.goto(`/game/${game.id}/admin/setup`);
    await page.click('button:has-text("Challenge Order (0)")');
    await expect(page.locator('text=No challenges created yet')).toBeVisible();
  });

  test('order panel can be closed', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Close Panel Test' });

    await page.goto(`/game/${game.id}/admin/setup`);
    await page.click('button:has-text("Challenge Order")');
    await expect(page.locator('h3:has-text("Challenge Order")')).toBeVisible();

    // Close the panel with x button
    await page.click('button:has-text("x")');
    await expect(page.locator('h3:has-text("Challenge Order")')).not.toBeVisible();
  });
});

test.describe('Admin Setup - No Spawn Offset', () => {
  test('challenge creation form does not have spawn offset field', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'No Offset Test' });

    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Click anywhere')).toBeVisible({ timeout: 5000 });

    // The setup page should NOT have any spawn offset controls
    const hasSpawnOffset = await page.locator('text=Spawn Offset').count();
    expect(hasSpawnOffset).toBe(0);

    const hasOffsetMinutes = await page.locator('text=spawnOffsetMinutes').count();
    expect(hasOffsetMinutes).toBe(0);
  });
});

test.describe('Admin Live Panel - Queue Settings', () => {
  test('shows active challenge count and expire minutes fields', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Queue Settings UI', activeChallengeCount: 5, challengeExpireMinutes: 15,
    });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // Should have Active (K) and Expire (min) fields
    await expect(page.locator('text=Active (K)')).toBeVisible();
    await expect(page.locator('text=Expire (min)')).toBeVisible();
  });

  test('queue settings can be updated', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Queue Update UI', activeChallengeCount: 3, challengeExpireMinutes: 10,
    });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // Find and update the Active (K) field
    const activeInput = page.locator('label:has-text("Active (K)")').locator('..').locator('input');
    await activeInput.fill('7');

    // Save Changes button should appear
    await expect(page.locator('button:has-text("Save Changes")')).toBeVisible();
    await page.click('button:has-text("Save Changes")');

    // Verify via API
    await page.waitForTimeout(1000);
    const { data: updated } = await api('GET', `/games/${game.id}`);
    expect(updated.active_challenge_count).toBe(7);
  });

  test('challenge status summary shows queue counts', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Status Summary', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 200, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    await page.goto(`/game/${game.id}/admin`);

    // Before starting: all queued
    await expect(page.locator('text=2 queued')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=0 active')).toBeVisible();
  });

  test('no leaderboard mode field in admin panel', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'No Mode Test' });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // Should NOT have leaderboard mode controls
    const modeCount = await page.locator('text=Leaderboard Mode').count();
    expect(modeCount).toBe(0);
    const blackoutCount = await page.locator('text=blackout').count();
    expect(blackoutCount).toBe(0);
  });
});

test.describe('Admin Live Panel - Challenge Statuses', () => {
  test('shows [queued] status for challenges before game start', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Queued Status' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Waiting', description: 'D', points: 100, lat: 41.88, lng: -87.62,
    });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=[queued]')).toBeVisible({ timeout: 5000 });
  });

  test('shows [active] status after game starts and challenges activate', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Active Status', activeChallengeCount: 1, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Will Activate', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=[active]')).toBeVisible({ timeout: 5000 });
  });
});
