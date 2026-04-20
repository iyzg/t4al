import { test, expect } from '@playwright/test';
import { io as ioClient } from 'socket.io-client';

const API = 'http://localhost:3001/api';
const WS = 'http://localhost:3001';
const SCREENSHOT_DIR = 'tests/screenshots';

async function api(method: string, path: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

function connectSocket() {
  return ioClient(WS, { transports: ['websocket'] });
}

test.describe('UI Screenshots', () => {

  test('1. Create Game page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1:has-text("Create a Game")')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-create-game.png`, fullPage: true });
  });

  test('2. Game Created success page', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[placeholder*="Friday"]', 'Chicago Downtown Hunt');
    await page.locator('input[type="number"]').fill('60');
    await page.click('button:has-text("Create Game")');
    await expect(page.locator('h1:has-text("Game Created!")')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-game-created.png`, fullPage: true });
  });

  test('3. Join page', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('h1:has-text("In the Loop")')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-join-page.png`, fullPage: true });
  });

  test('4. Join page - lobby with teams', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Screenshot Game' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Red Rockets', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Blue Blazers', color: '#3498db' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Green Machine', color: '#2ecc71' });

    await page.goto('/join');
    await page.fill('input[placeholder*="a1b2c3"]', game.join_code);
    await page.click('button:has-text("Join Game")');
    await expect(page.locator('text=Red Rockets')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-lobby-with-teams.png`, fullPage: true });
  });

  test('5. Admin Setup - map with challenges', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Setup Screenshot' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'Take a selfie with the Bean', points: 200,
      lat: 41.8827, lng: -87.6233, sortOrder: 1, proximityMeters: 100,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'Find the lions', points: 300,
      lat: 41.8796, lng: -87.6237, sortOrder: 2, proximityMeters: 150,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Willis Tower', description: 'Look up!', points: 150,
      lat: 41.8789, lng: -87.6359, sortOrder: 3, proximityMeters: 200,
    });

    await page.goto(`/game/${game.id}/admin/setup`);
    await expect(page.locator('text=Click anywhere')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000); // let map render
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-admin-setup-map.png`, fullPage: true });
  });

  test('6. Admin Setup - challenge order panel', async ({ page }) => {
    const { data: game } = await api('POST', '/games', { name: 'Order Screenshot' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'D', points: 200, lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'D', points: 300, lat: 41.8796, lng: -87.6237, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Willis Tower', description: 'D', points: 150, lat: 41.8789, lng: -87.6359, sortOrder: 3,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Buckingham Fountain', description: 'D', points: 250, lat: 41.8758, lng: -87.6189, sortOrder: 4,
    });

    await page.goto(`/game/${game.id}/admin/setup`);
    await page.click('button:has-text("Challenge Order")');
    await expect(page.locator('h3:has-text("Challenge Order")')).toBeVisible();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-challenge-order-panel.png`, fullPage: true });
  });

  test('7. Admin Panel - lobby state', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Chicago Downtown Hunt', activeChallengeCount: 3, challengeExpireMinutes: 15,
    });
    await api('POST', `/games/${game.id}/teams`, { name: 'Red Rockets', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Blue Blazers', color: '#3498db' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'D', points: 200, lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'D', points: 300, lat: 41.8796, lng: -87.6237, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Willis Tower', description: 'D', points: 150, lat: 41.8789, lng: -87.6359, sortOrder: 3,
    });

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.locator('text=Admin Panel')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-admin-lobby.png`, fullPage: true });
  });

  test('8. Admin Panel - active game with queue', async ({ page }) => {
    test.setTimeout(60000);
    const { data: game } = await api('POST', '/games', {
      name: 'Active Game Screenshot', activeChallengeCount: 2, challengeExpireMinutes: 15,
    });
    await api('POST', `/games/${game.id}/teams`, { name: 'Red Rockets', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Blue Blazers', color: '#3498db' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'D', points: 200, lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'D', points: 300, lat: 41.8796, lng: -87.6237, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Willis Tower', description: 'D', points: 150, lat: 41.8789, lng: -87.6359, sortOrder: 3,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000)); // wait for challenges to activate

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.getByText('ACTIVE', { exact: true }).first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(6000); // let poll cycle update
    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-admin-active-game.png`, fullPage: true });
  });

  test('9. Game page - player view with challenges on map', async ({ page }) => {
    test.setTimeout(60000);
    const { data: game } = await api('POST', '/games', {
      name: 'Player View', activeChallengeCount: 3, challengeExpireMinutes: 15,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'My Team', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/teams`, { name: 'Rival Team', color: '#3498db' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'Take a selfie with the Bean', points: 200,
      lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'Find the lions', points: 300,
      lat: 41.8796, lng: -87.6237, sortOrder: 2,
    });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Willis Tower', description: 'Look up!', points: 150,
      lat: 41.8789, lng: -87.6359, sortOrder: 3,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Set identity and navigate
    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await page.waitForTimeout(5000); // let map + challenges render
    await page.screenshot({ path: `${SCREENSHOT_DIR}/09-player-game-view.png`, fullPage: true });
  });

  test('10. Game page - pie chart markers (teams on challenges)', async ({ page }) => {
    test.setTimeout(60000);
    const { data: game } = await api('POST', '/games', {
      name: 'Pie Chart View', activeChallengeCount: 2, challengeExpireMinutes: 15,
    });
    const { data: team1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Red Team', color: '#e74c3c' });
    const { data: team2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Blue Team', color: '#3498db' });
    const { data: team3 } = await api('POST', `/games/${game.id}/teams`, { name: 'Green Team', color: '#2ecc71' });
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'Bean!', points: 200,
      lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });
    const { data: c2 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Art Institute', description: 'Lions!', points: 300,
      lat: 41.8796, lng: -87.6237, sortOrder: 2,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Have teams activate challenges via sockets so pie charts appear
    const socket1 = connectSocket();
    const socket2 = connectSocket();
    const socket3 = connectSocket();

    await Promise.all([
      new Promise<void>((r) => { socket1.on('game:state', () => r()); socket1.emit('game:join', { gameId: game.id, teamId: team1.id }); }),
      new Promise<void>((r) => { socket2.on('game:state', () => r()); socket2.emit('game:join', { gameId: game.id, teamId: team2.id }); }),
      new Promise<void>((r) => { socket3.on('game:state', () => r()); socket3.emit('game:join', { gameId: game.id, teamId: team3.id }); }),
    ]);

    // Red and Blue on Cloud Gate, Green on Art Institute
    socket1.emit('challenge:activate', { challengeId: c1.id, teamId: team1.id });
    await new Promise(r => setTimeout(r, 300));
    socket2.emit('challenge:activate', { challengeId: c1.id, teamId: team2.id });
    await new Promise(r => setTimeout(r, 300));
    socket3.emit('challenge:activate', { challengeId: c2.id, teamId: team3.id });
    await new Promise(r => setTimeout(r, 1000));

    // Now view as team1 — should see pie chart on Cloud Gate (red + blue)
    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team1.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await page.waitForTimeout(5000); // let markers render with pie chart
    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-pie-chart-markers.png`, fullPage: true });

    socket1.disconnect();
    socket2.disconnect();
    socket3.disconnect();
  });

  test('11. Game page - challenge card (selected, not in range)', async ({ page }) => {
    test.setTimeout(60000);
    const { data: game } = await api('POST', '/games', {
      name: 'Card View', activeChallengeCount: 1, challengeExpireMinutes: 15,
    });
    const { data: team } = await api('POST', `/games/${game.id}/teams`, { name: 'Explorer', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Cloud Gate', description: 'Take a photo with the Bean', points: 200,
      lat: 41.8827, lng: -87.6233, sortOrder: 1,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    await page.goto('/');
    await page.evaluate((identity) => {
      sessionStorage.setItem('t4al_identity', JSON.stringify(identity));
    }, { gameId: game.id, teamId: team.id, teamColor: '#e74c3c' });

    await page.goto(`/game/${game.id}`);
    await page.waitForTimeout(4000);

    // Click a challenge marker
    const markers = page.locator('[style*="border-radius: 50%"][style*="cursor: pointer"]');
    const count = await markers.count();
    if (count > 0) {
      await markers.first().click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/11-challenge-card.png`, fullPage: true });
  });

  test('12. End page - final standings', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Final Standings', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Winners', color: '#f1c40f' });
    const { data: t2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Runners Up', color: '#e74c3c' });
    const { data: t3 } = await api('POST', `/games/${game.id}/teams`, { name: 'Third Place', color: '#3498db' });
    const { data: c1 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'C1', description: 'D', points: 500, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    const { data: c2 } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'C2', description: 'D', points: 300, lat: 41.881, lng: -87.621, sortOrder: 2,
    });

    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));
    await api('POST', `/challenges/${c1.id}/claim`, { teamId: t1.id });
    await api('POST', `/challenges/${c2.id}/claim`, { teamId: t2.id });
    await api('POST', `/games/${game.id}/end`);

    await page.goto(`/game/${game.id}/end`);
    await expect(page.locator('text=Winners')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/12-end-page.png`, fullPage: true });
  });

  test('13. Admin Panel - ended game', async ({ page }) => {
    const { data: game } = await api('POST', '/games', {
      name: 'Ended Game Screenshot', activeChallengeCount: 2, challengeExpireMinutes: 10,
    });
    await api('POST', `/games/${game.id}/teams`, { name: 'Team A', color: '#e74c3c' });
    await api('POST', `/games/${game.id}/challenges`, {
      name: 'Done', description: 'D', points: 100, lat: 41.88, lng: -87.62, sortOrder: 1,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));
    await api('POST', `/games/${game.id}/end`);

    await page.goto(`/game/${game.id}/admin`);
    await expect(page.getByText('ENDED', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/13-admin-ended.png`, fullPage: true });
  });
});
