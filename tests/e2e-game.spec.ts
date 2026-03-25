import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Game Page', () => {
  test('redirects to /join when no identity exists', async ({ page }) => {
    // Clear any existing session storage
    await page.goto('/join');
    await page.evaluate(() => sessionStorage.clear());

    // Try to navigate directly to a game page
    const game = (await api('POST', '/games', { name: 'No Identity Test' })).data;
    await page.goto(`/game/${game.id}`);

    // Should redirect to join page
    await expect(page).toHaveURL('/join');
  });

  test('shows HUD components when identity exists', async ({ page }) => {
    const game = (await api('POST', '/games', { name: 'HUD Test' })).data;
    const team = (await api('POST', `/games/${game.id}/teams`, { name: 'Testers', color: '#e74c3c' })).data;
    await api('POST', `/games/${game.id}/start`);

    // Set identity in sessionStorage before navigating
    await page.goto('/join');
    await page.evaluate(({ gid, tid }) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify({
        gameId: gid, teamId: tid, teamColor: '#e74c3c',
      }));
    }, { gid: game.id, tid: team.id });

    await page.goto(`/game/${game.id}`);

    // Should show the game HUD with game name
    await expect(page.locator('text=HUD Test')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('End Page', () => {
  test('shows final standings', async ({ page }) => {
    const game = (await api('POST', '/games', { name: 'End Page Test' })).data;
    await api('POST', `/games/${game.id}/teams`, { name: 'Winners', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Losers', color: '#3498db' });
    await api('POST', `/games/${game.id}/start`);
    await api('POST', `/games/${game.id}/end`);

    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('h1')).toHaveText('End Page Test');
    await expect(page.locator('h2')).toHaveText('Final Standings');
    await expect(page.locator('text=Winners')).toBeVisible();
    await expect(page.locator('text=Losers')).toBeVisible();
  });

  test('has navigation links to new game and join', async ({ page }) => {
    const game = (await api('POST', '/games', { name: 'Nav Test' })).data;
    await page.goto(`/game/${game.id}/end`);

    await expect(page.locator('a:has-text("New Game")')).toBeVisible();
    await expect(page.locator('a:has-text("Join Another Game")')).toBeVisible();
  });

  test('shows message when no teams played', async ({ page }) => {
    const game = (await api('POST', '/games', { name: 'Empty Game' })).data;
    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=No teams played')).toBeVisible();
  });
});
