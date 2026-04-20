import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function createGame(name = 'Responsive Test') {
  const res = await fetch(`${API}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, durationMinutes: 30 }),
  });
  return res.json();
}

const VIEWPORTS = {
  'iPhone SE': { width: 375, height: 667 },
  'iPhone 14': { width: 390, height: 844 },
  'iPad': { width: 768, height: 1024 },
  'Laptop': { width: 1280, height: 720 },
};

for (const [device, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`Responsive: ${device} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport });

    test('Create Game page renders without overflow', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('h1')).toBeVisible();
      // Check no horizontal scrollbar
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1 for rounding
    });

    test('Join page renders without overflow', async ({ page }) => {
      await page.goto('/join');
      await expect(page.locator('h1')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test('Admin panel renders without overflow', async ({ page }) => {
      const game = await createGame(`Admin ${device}`);
      await page.goto(`/game/${game.id}/admin`);
      await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test('End page renders without overflow', async ({ page }) => {
      const game = await createGame(`End ${device}`);
      await page.goto(`/game/${game.id}/end`);
      await expect(page.locator('h2')).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  });
}
