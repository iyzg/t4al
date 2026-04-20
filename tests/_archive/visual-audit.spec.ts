import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Visual Audit', () => {
  test('admin panel elements do not overlap on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { data: game } = await api('POST', '/games', { name: 'Visual Audit' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Team Alpha', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Team Beta', color: '#3498db' });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });

    // All team entries should be visible
    await expect(page.locator('text=Team Alpha')).toBeVisible();
    await expect(page.locator('text=Team Beta')).toBeVisible();

    // Verify no element extends beyond viewport
    const overflows = await page.evaluate(() => {
      const issues: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.right > window.innerWidth + 2 && rect.width > 0) {
          issues.push(`${el.tagName}.${el.className}: right=${Math.round(rect.right)} > viewport=${window.innerWidth}`);
        }
      });
      return issues;
    });
    expect(overflows).toEqual([]);
  });

  test('join page lobby displays correctly with many teams', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Many Teams' });
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    for (let i = 0; i < colors.length; i++) {
      await api('POST', `/games/${game.id}/teams`, { name: `Team ${i + 1}`, color: colors[i] });
    }

    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // All teams should be visible
    for (let i = 1; i <= 5; i++) {
      await expect(page.locator(`text=Team ${i}`)).toBeVisible();
    }

    // Only 2 colors left (#1abc9c, #e67e22) — both should show as buttons
    const colorButtons = page.locator('div[style*="flex-wrap"] button');
    expect(await colorButtons.count()).toBe(2);
  });

  test('join page shows message when all colors taken', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Full Colors' });
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];
    for (let i = 0; i < colors.length; i++) {
      await api('POST', `/games/${game.id}/teams`, { name: `T${i + 1}`, color: colors[i] });
    }

    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Should show "all colors taken" message
    await expect(page.locator('text=All colors are taken')).toBeVisible();
    // Should NOT show the create team form
    await expect(page.locator('text=Create Team')).not.toBeVisible();
  });

  test('end page with long team names does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const { data: game } = await api('POST', '/games', { name: 'Long Names Test' });
    await api('POST', `/games/${game.id}/teams`, { name: 'The Incredibly Long Team Name That Might Break Layout', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Short', color: '#3498db' });

    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=Long Names Test')).toBeVisible({ timeout: 5000 });

    // Check no horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('create game page buttons stack on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 }); // iPhone 5/SE gen1
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Narrow Test');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1')).toHaveText('Game Created!');

    // Buttons should still be visible and not overflow
    await expect(page.locator('button:has-text("Set Up Challenges")')).toBeVisible();
    await expect(page.locator('button:has-text("Go to Admin Panel")')).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
