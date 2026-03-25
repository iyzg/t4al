import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function createGame(name = 'Join Test') {
  const res = await fetch(`${API}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, durationMinutes: 30 }),
  });
  return res.json();
}

async function createTeam(gameId: string, name: string, color: string) {
  const res = await fetch(`${API}/games/${gameId}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  return res.json();
}

test.describe('Join Page', () => {
  test('loads at /join', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('h1')).toHaveText('In the Loop');
    await expect(page.locator('input[placeholder*="a1b2c3"]')).toBeVisible();
  });

  test('shows error for invalid join code', async ({ page }) => {
    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', 'zzzzzz');
    await page.click('button:has-text("Join Game")');
    await expect(page.locator('text=Invalid join code')).toBeVisible();
  });

  test('valid join code shows lobby with game name', async ({ page }) => {
    const game = await createGame('Lobby Visible');
    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');
    await expect(page.locator('h1')).toHaveText('Lobby Visible');
    await expect(page.locator('text=No teams yet')).toBeVisible();
  });

  test('can create a team and join', async ({ page }) => {
    const game = await createGame('Team Join Test');
    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Create a team
    await page.fill('input[placeholder="Team name"]', 'Speed Demons');
    await page.click('button:has-text("Create & Join")');

    // Should navigate to the game page
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}`));
  });

  test('can join an existing team', async ({ page }) => {
    const game = await createGame('Existing Team Test');
    const team = await createTeam(game.id, 'The Navigators', '#3498db');

    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Should show the existing team
    await expect(page.locator('text=The Navigators')).toBeVisible();
    await page.getByRole('button', { name: 'Join', exact: true }).click();

    // Should navigate to the game page
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}`));
  });

  test('hides taken colors in lobby', async ({ page }) => {
    const game = await createGame('Color Test');
    await createTeam(game.id, 'Red Team', '#e74c3c');

    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Red color should NOT be visible as a selectable button
    const colorButtons = page.locator('div[style*="flex-wrap"] button');
    const count = await colorButtons.count();
    for (let i = 0; i < count; i++) {
      const bg = await colorButtons.nth(i).evaluate((el) => getComputedStyle(el).background);
      expect(bg).not.toContain('rgb(231, 76, 60)'); // #e74c3c
    }
  });

  test('stores identity in sessionStorage after joining', async ({ page }) => {
    const game = await createGame('Session Test');
    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');
    await page.fill('input[placeholder="Team name"]', 'Storage Test');
    await page.click('button:has-text("Create & Join")');

    await expect(page).toHaveURL(new RegExp(`/game/${game.id}`));

    const identity = await page.evaluate(() => sessionStorage.getItem('t4al_identity'));
    expect(identity).toBeTruthy();
    const parsed = JSON.parse(identity!);
    expect(parsed.gameId).toBe(game.id);
    expect(parsed.teamId).toBeTruthy();
    expect(parsed.teamColor).toBeTruthy();
  });
});
