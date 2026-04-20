import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Full Game Flow - Queue Model', () => {
  test('complete game lifecycle: create → setup → play → end', async ({ page }) => {
    test.setTimeout(120000); // this test involves multiple ticker waits
    // 1. Create game with queue settings
    const { data: game } = await api('POST', '/games', {
      name: 'Full Flow Test',
      durationMinutes: 60,
      activeChallengeCount: 2,
      challengeExpireMinutes: 10,
    });

    // 2. Create challenges with specific order
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'First Challenge', description: 'Find something', points: 100,
      lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    const { data: c2 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Second Challenge', description: 'Find another thing', points: 200,
      lat: 41.8837, lng: -87.6243, sortOrder: 2,
    });
    const { data: c3 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Third Challenge', description: 'Find last thing', points: 300,
      lat: 41.8847, lng: -87.6253, sortOrder: 3,
    });

    // 3. Create teams
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Alpha', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Beta', color: '#3498db' });

    // 4. Verify admin panel shows correct state before game start
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=LOBBY')).toBeVisible();
    await expect(page.locator('text=Alpha')).toBeVisible();
    await expect(page.locator('text=Beta')).toBeVisible();
    await expect(page.locator('text=3 queued')).toBeVisible({ timeout: 10000 });

    // 5. Start the game
    await page.click('button:has-text("Start Game")');
    await expect(page.getByText('ACTIVE', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 6. Wait for first K=2 challenges to activate
    await page.waitForTimeout(12000);
    await expect(page.locator('text=[active]').first()).toBeVisible({ timeout: 5000 });

    // Verify via API
    const { data: challenges } = await api('GET', `/games/${game.id}/challenges`);
    const active = challenges.filter((c: any) => c.status === 'active');
    const queued = challenges.filter((c: any) => c.status === 'queued');
    expect(active.length).toBe(2);
    expect(queued.length).toBe(1);

    // 7. Team 1 claims the first challenge
    const { status: claimStatus } = await api('POST', `/challenges/${c1.id}/claim`, { teamId: team1.id });
    expect(claimStatus).toBe(200);

    // 8. Wait for queue to advance — third challenge should now activate
    await page.waitForTimeout(12000);

    const { data: afterClaim } = await api('GET', `/games/${game.id}/challenges`);
    const activeAfter = afterClaim.filter((c: any) => c.status === 'active');
    const claimedAfter = afterClaim.filter((c: any) => c.status === 'claimed');
    expect(claimedAfter.length).toBe(1);
    expect(activeAfter.length).toBe(2); // c2 + c3 now active

    // 9. Verify team scores
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const t1 = teams.find((t: any) => t.id === team1.id);
    expect(t1.score).toBe(100);

    // 10. Check event log shows the claim
    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=claimed')).toBeVisible({ timeout: 10000 });

    // 11. End the game
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('button:has-text("End Game")');
    await expect(page.getByText('ENDED', { exact: true }).first()).toBeVisible({ timeout: 10000 });

    // 12. Verify end page
    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=Full Flow Test')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Alpha')).toBeVisible();
    await expect(page.locator('text=Beta')).toBeVisible();
    await expect(page.locator('text=100 pts')).toBeVisible();
  });

  test('create game page flow', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("Create a Game")')).toBeVisible();

    // Fill in game details
    await page.fill('input[placeholder*="Friday"]', 'UI Flow Game');
    await page.locator('input[type="number"]').fill('45');

    // Create
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1:has-text("Game Created!")')).toBeVisible({ timeout: 5000 });

    // Should show join code and admin code
    const codes = await page.locator('code').allTextContents();
    expect(codes.length).toBeGreaterThanOrEqual(2);
    expect(codes[0].length).toBeGreaterThan(0); // join code
    expect(codes[1].length).toBeGreaterThan(0); // admin code

    // Should have Set Up Challenges and Admin Panel buttons
    await expect(page.locator('button:has-text("Set Up Challenges")')).toBeVisible();
    await expect(page.locator('button:has-text("Go to Admin Panel")')).toBeVisible();
  });

  test('join page flow', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Join Flow Game' });

    await page.goto('/join');
    await expect(page.locator('h1:has-text("In the Loop")')).toBeVisible();

    // Enter join code
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');

    // Should see lobby
    await expect(page.locator(`text=${game.name}`)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=No teams yet')).toBeVisible();

    // Create a team
    await page.fill('input[placeholder="Team name"]', 'My Team');
    await page.click('button:has-text("Create & Join")');

    // Should navigate to game page
    await expect(page).toHaveURL(new RegExp(`/game/${game.id}`), { timeout: 5000 });
  });
});
