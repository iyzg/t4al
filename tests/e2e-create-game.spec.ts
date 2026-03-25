import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

test.describe('Create Game Page', () => {
  test('loads at root URL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Create a Game');
  });

  test('shows validation error for empty name', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('text=Game name is required')).toBeVisible();
  });

  test('creates a game and shows codes', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Playwright Test Game');
    await page.click('button:has-text("Create Game")');

    // Should show the success screen with codes
    await expect(page.locator('h1')).toHaveText('Game Created!');
    await expect(page.locator('text=Join Code')).toBeVisible();
    await expect(page.locator('text=Admin Code')).toBeVisible();

    // Should have navigation buttons
    await expect(page.locator('button:has-text("Set Up Challenges")')).toBeVisible();
    await expect(page.locator('button:has-text("Go to Admin Panel")')).toBeVisible();
  });

  test('Set Up Challenges button navigates to admin setup', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Nav Test Game');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1')).toHaveText('Game Created!');
    await page.click('button:has-text("Set Up Challenges")');
    await expect(page).toHaveURL(/\/admin\/setup$/);
  });

  test('Go to Admin Panel button navigates to admin page', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Nav Test Game 2');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1')).toHaveText('Game Created!');
    await page.click('button:has-text("Go to Admin Panel")');
    await expect(page).toHaveURL(/\/admin$/);
  });
});
