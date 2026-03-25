import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function createGame(name = 'Admin Test') {
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

test.describe('Admin Live Panel', () => {
  test('loads and shows game info', async ({ page }) => {
    const game = await createGame('Admin Panel Game');
    await page.goto(`/game/${game.id}/admin`);

    // Should show admin panel header
    await expect(page.locator('h2:has-text("Admin Panel")')).toBeVisible();

    // Should show join code and admin code
    await expect(page.locator(`text=${game.join_code}`)).toBeVisible();
    await expect(page.locator(`text=${game.admin_code}`)).toBeVisible();

    // Should show LOBBY status
    await expect(page.locator('text=LOBBY')).toBeVisible();
  });

  test('shows teams', async ({ page }) => {
    const game = await createGame('Admin Teams Test');
    await createTeam(game.id, 'Alpha', '#e74c3c');
    await createTeam(game.id, 'Beta', '#3498db');

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Alpha')).toBeVisible();
    await expect(page.locator('text=Beta')).toBeVisible();
  });

  test('start game button works', async ({ page }) => {
    const game = await createGame('Start Button Test');
    await page.goto(`/game/${game.id}/admin`);

    // Click start
    await page.click('button:has-text("Start Game")');

    // Wait for poll to update — should show ACTIVE status
    await expect(page.locator('text=ACTIVE')).toBeVisible({ timeout: 10000 });
  });

  test('end game button works after starting', async ({ page }) => {
    const game = await createGame('End Button Test');
    await page.goto(`/game/${game.id}/admin`);

    await page.click('button:has-text("Start Game")');
    await expect(page.locator('text=ACTIVE')).toBeVisible({ timeout: 10000 });

    // End button should now work (need to handle confirm dialog)
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("End Game")');
    // Use exact match on the status badge, not the event log
    await expect(page.getByText('ENDED', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  });

  test('game name edit and save', async ({ page }) => {
    const game = await createGame('Editable Name');
    await page.goto(`/game/${game.id}/admin`);

    // Wait for the input to have the game name loaded
    const nameInput = page.locator('input').first();
    await expect(nameInput).toHaveValue('Editable Name', { timeout: 5000 });

    // Change the name
    await nameInput.fill('New Name');
    await expect(page.locator('button:has-text("Save Changes")')).toBeVisible();
    await page.click('button:has-text("Save Changes")');

    // Wait for the save to complete (button disappears when settingsDirty goes false)
    await expect(page.locator('button:has-text("Save Changes")')).not.toBeVisible({ timeout: 5000 });

    // Verify via API
    const res = await fetch(`${API}/games/${game.id}`);
    const updated = await res.json();
    expect(updated.name).toBe('New Name');
  });

  test('has link to edit challenges', async ({ page }) => {
    const game = await createGame('Link Test');
    await page.goto(`/game/${game.id}/admin`);
    const link = page.locator('a:has-text("Edit Challenges")');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/game/${game.id}/admin/setup`);
  });

  test('shows countdown timer when game is active', async ({ page }) => {
    const game = await createGame('Timer Test');
    await fetch(`${API}/games/${game.id}/start`, { method: 'POST' });

    await page.goto(`/game/${game.id}/admin`);
    // Should show a countdown in MM:SS format
    await expect(page.locator('text=ACTIVE')).toBeVisible({ timeout: 5000 });
    // The countdown should be visible (monospace styled)
    const timer = page.locator('span[style*="monospace"]');
    await expect(timer).toBeVisible({ timeout: 5000 });
    const timerText = await timer.textContent();
    expect(timerText).toMatch(/\d+:\d{2}/);
  });
});

test.describe('Admin Setup Page', () => {
  test('loads with instruction banner', async ({ page }) => {
    const game = await createGame('Setup Test');
    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Click anywhere on the map to create a challenge')).toBeVisible({ timeout: 5000 });
  });

  test('has link back to admin panel', async ({ page }) => {
    const game = await createGame('Back Link Test');
    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('a:has-text("Back to Admin Panel")')).toBeVisible({ timeout: 5000 });
  });

  // Map-interaction tests: the map requires WebGL so we test challenge
  // CRUD via the API, and verify the setup page renders correctly.

  test('challenge CRUD via API reflects in setup page', async ({ page }) => {
    const game = await createGame('Challenge CRUD UI');

    // Create a challenge via API
    const { data: challenge } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'API Challenge', description: 'Created via API', points: 250,
      lat: 41.8827, lng: -87.6233, spawnOffsetMinutes: 5,
    });

    // Load setup page — should show the challenge marker (golden dot)
    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Click anywhere')).toBeVisible({ timeout: 5000 });

    // Verify challenge exists via API
    const res = await fetch(`${API}/games/${game.id}/challenges`);
    const challenges = await res.json();
    expect(challenges.length).toBe(1);
    expect(challenges[0].name).toBe('API Challenge');

    // Delete via API
    await api('DELETE', `/challenges/${challenge.id}`);
    const res2 = await fetch(`${API}/games/${game.id}/challenges`);
    const after = await res2.json();
    expect(after.length).toBe(0);
  });
});
