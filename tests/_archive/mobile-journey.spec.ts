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

test.describe('Mobile Player Journey (iPhone 14)', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 41.8827, longitude: -87.6233 },
    permissions: ['geolocation'],
  });

  test('complete journey: join → lobby → game → end', async ({ page }) => {
    // 1. Admin creates game + challenges via API
    const { data: game } = await api('POST', '/games', { name: 'Mobile Journey', durationMinutes: 60 });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Bean Challenge', description: 'Go to the Bean!', points: 250,
      lat: 41.8827, lng: -87.6233,
    });

    // 2. Player visits join page on mobile
    await page.goto('/join');
    await ss(page, 'mobile-01-join-page');
    await expect(page.locator('h1')).toHaveText('In the Loop');

    // 3. Enter join code
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');
    await expect(page.locator('h1')).toHaveText('Mobile Journey');
    await ss(page, 'mobile-02-lobby');

    // 4. Create team
    await page.fill('input[placeholder="Team name"]', 'Phone Squad');
    // Select second color (first should be auto-selected)
    await page.click('button:has-text("Create & Join")');

    // 5. Should be on game page in lobby
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}`));
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Waiting for game to start')).toBeVisible({ timeout: 5000 });
    await ss(page, 'mobile-03-game-waiting');

    // 6. Admin starts game
    await api('POST', `/games/${game.id}/start`);

    // 7. Wait for challenge spawn + game:started socket event
    await new Promise(r => setTimeout(r, 12000));

    // 8. Player should now see HUD with countdown
    await page.waitForTimeout(2000);
    await ss(page, 'mobile-04-game-active');

    // Verify game name shows in HUD
    await expect(page.locator('text=Mobile Journey')).toBeVisible({ timeout: 5000 });

    // 9. Admin ends the game
    await api('POST', `/games/${game.id}/end`);

    // 10. Player redirected to end page
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}/end`), { timeout: 10000 });
    await ss(page, 'mobile-05-end-page');
    await expect(page.locator('text=Final Standings')).toBeVisible();
    await expect(page.locator('text=Phone Squad')).toBeVisible();

    // 11. Navigation buttons work on mobile
    await expect(page.locator('a:has-text("New Game")')).toBeVisible();
    await expect(page.locator('a:has-text("Join Another Game")')).toBeVisible();

    // 12. Check no overflow on end page
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390 + 1);
  });
});

test.describe('Mobile Admin Journey (iPad)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('create game → setup → admin panel flow', async ({ page }) => {
    // 1. Create game on iPad
    await page.goto('/');
    await ss(page, 'mobile-06-ipad-create');
    await page.fill('input[placeholder*="Friday"]', 'iPad Game');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1')).toHaveText('Game Created!');
    await ss(page, 'mobile-07-ipad-created');

    // Navigate to admin
    await page.click('button:has-text("Go to Admin Panel")');
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });
    await ss(page, 'mobile-08-ipad-admin');

    // Admin panel should have sidebar visible (768px > 768px breakpoint)
    const sidebar = page.locator('.admin-sidebar');
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).toBeTruthy();
    expect(sidebarBox!.width).toBeGreaterThan(0);

    // No overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(768 + 1);
  });
});
