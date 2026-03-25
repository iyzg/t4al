import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('UI Element Overlap & Accessibility', () => {
  test('admin panel: buttons are clickable and not overlapping', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Button Test' });
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // Start button should be enabled in lobby
    const startBtn = page.locator('button:has-text("Start Game")');
    await expect(startBtn).toBeEnabled();

    // End button should be disabled in lobby
    const endBtn = page.locator('button:has-text("End Game")');
    await expect(endBtn).toBeDisabled();

    // Buttons should not overlap each other
    const startBox = await startBtn.boundingBox();
    const endBox = await endBtn.boundingBox();
    expect(startBox).toBeTruthy();
    expect(endBox).toBeTruthy();
    // Right edge of start should be left of end's left edge (with some gap)
    expect(startBox!.x + startBox!.width).toBeLessThanOrEqual(endBox!.x + 2);
  });

  test('admin panel: edit link and header do not overlap', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Overlap Test' });
    await page.goto(`/game/${game.id}/admin`);

    const header = page.locator('h2:has-text("Admin Panel")');
    const editLink = page.locator('a:has-text("Edit Challenges")');
    await expect(header).toBeVisible({ timeout: 5000 });
    await expect(editLink).toBeVisible();

    const hBox = await header.boundingBox();
    const lBox = await editLink.boundingBox();
    // They should not vertically overlap (same row) — header left, link right
    expect(hBox).toBeTruthy();
    expect(lBox).toBeTruthy();
    // Link should be to the right of the header
    expect(lBox!.x).toBeGreaterThan(hBox!.x + hBox!.width - 10);
  });

  test('join page: color buttons have minimum touch size', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Touch Test' });
    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Wait for lobby to load and color buttons to render
    await expect(page.locator('text=Create Team')).toBeVisible();

    // Find circular color buttons (40x40 with border-radius)
    const colorButtons = page.locator('button[style*="border-radius: 50%"]');
    const count = await colorButtons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await colorButtons.nth(i).boundingBox();
      expect(box).toBeTruthy();
      // Touch targets should be at least 36px (close to Apple's 44px guideline)
      expect(box!.width).toBeGreaterThanOrEqual(36);
      expect(box!.height).toBeGreaterThanOrEqual(36);
    }
  });

  test('create game: form inputs are full width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const nameInput = page.locator('input[placeholder*="Friday"]');
    const durationInput = page.locator('input[type="number"]');

    const nameBox = await nameInput.boundingBox();
    const durBox = await durationInput.boundingBox();

    // Both inputs should span most of the container width
    expect(nameBox!.width).toBeGreaterThan(300);
    expect(durBox!.width).toBeGreaterThan(300);
  });

  test('end page: standings cards do not overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { data: game } = await api('POST', '/games', { name: 'Standings Overflow' });
    await api('POST', `/games/${game.id}/teams`, { name: 'A Very Long Team Name Indeed', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Another Very Long Team Name', color: '#3498db' });

    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=Final Standings')).toBeVisible();

    // Check all standing cards fit within viewport
    const cards = page.locator('div[style*="justifyContent"]');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const box = await cards.nth(i).boundingBox();
      if (box && box.width > 50) { // skip tiny elements
        expect(box.x + box.width).toBeLessThanOrEqual(375 + 2);
      }
    }
  });

  test('admin setup: instruction banner and back link both visible', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Setup Banner' });
    await page.goto(`/game/${game.id}/admin/setup`);

    const banner = page.locator('text=Click anywhere');
    const backLink = page.locator('a:has-text("Back to Admin Panel")');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(backLink).toBeVisible();

    // Both should be in the same bar, not overlapping
    const bannerBox = await banner.boundingBox();
    const linkBox = await backLink.boundingBox();
    expect(bannerBox).toBeTruthy();
    expect(linkBox).toBeTruthy();
    // Back link should be to the right of the instruction text
    expect(linkBox!.x).toBeGreaterThan(bannerBox!.x);
  });

  test('admin setup: instruction bar fits on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { data: game } = await api('POST', '/games', { name: 'Mobile Bar' });
    await page.goto(`/game/${game.id}/admin/setup`);

    await expect(page.locator('text=Click anywhere')).toBeVisible({ timeout: 5000 });

    // Check no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375 + 1);
  });
});
