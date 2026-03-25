import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Admin Complete Workflow', () => {
  test('create game → setup challenges → start → verify', async ({ page }) => {
    // 1. Create game via UI
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Workflow Test');
    await page.locator('input[type="number"]').fill('30');
    await page.click('button:has-text("Create Game")');

    // Capture the game info from the success screen
    await expect(page.locator('h1')).toHaveText('Game Created!');
    const joinCodeEl = page.locator('code').first();
    const joinCode = await joinCodeEl.textContent();
    expect(joinCode).toBeTruthy();

    // Navigate to admin panel
    await page.click('button:has-text("Go to Admin Panel")');
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // 2. Verify game name shows correctly
    const nameInput = page.locator('input').first();
    await expect(nameInput).toHaveValue('Workflow Test', { timeout: 5000 });

    // 3. Verify join code is displayed
    await expect(page.locator(`text=${joinCode}`)).toBeVisible();

    // 4. Add a challenge via API (since map requires WebGL)
    // Extract game ID from URL
    const url = page.url();
    const gameId = url.match(/\/game\/([^/]+)\//)?.[1];
    expect(gameId).toBeTruthy();

    await api('POST', `/games/${gameId}/challenges`, {
      name: 'Workflow Challenge', description: 'Test', points: 100,
      lat: 41.8827, lng: -87.6233, spawnOffsetMinutes: 0,
    });

    // Wait for next poll cycle
    await page.waitForTimeout(6000);

    // 5. Verify challenge appears in the list
    await expect(page.locator('text=Workflow Challenge')).toBeVisible();

    // 6. Start the game
    await page.click('button:has-text("Start Game")');
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible({ timeout: 10000 });

    // 7. Verify countdown timer appears
    const timer = page.locator('span[style*="monospace"]');
    await expect(timer).toBeVisible({ timeout: 5000 });

    // 8. Wait for challenge to spawn and verify status change
    await page.waitForTimeout(12000);
    await expect(page.locator('text=[active]')).toBeVisible({ timeout: 5000 });

    // 9. Verify event log has entries
    await expect(page.locator('text=game:started')).toBeVisible();
    await expect(page.locator('text=challenge:spawned')).toBeVisible();
  });

  test('end game workflow and verify end page', async ({ page }) => {
    // Setup: create and start a game
    const { data: game } = await api('POST', '/games', { name: 'End Workflow', durationMinutes: 30 });
    await api('POST', `/games/${game.id}/teams`, { name: 'Finishers', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/start`);

    // Go to admin panel
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=ACTIVE')).toBeVisible({ timeout: 10000 });

    // End the game
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("End Game")');
    await expect(page.getByText('ENDED', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // Navigate to end page
    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=End Workflow')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Finishers')).toBeVisible();
    await expect(page.locator('text=0 pts')).toBeVisible();
  });
});
