import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';

async function api(method: string, p: string, body?: any) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${p}`, opts);
  return { status: res.status, data: await res.json() };
}

test.describe('Concurrent Operations', () => {
  test('concurrent claims on same challenge — only one succeeds', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Concurrent Claim' });
    const { data: t1 } = await api('POST', `/games/${game.id}/teams`, { name: 'Fast', color: '#e74c3c' });
    const { data: t2 } = await api('POST', `/games/${game.id}/teams`, { name: 'Faster', color: '#3498db' });
    const { data: c } = await api('POST', `/games/${game.id}/challenges`, {
      name: 'Race', description: 'D', points: 1000, lat: 41.88, lng: -87.62,
    });
    await api('POST', `/games/${game.id}/start`);
    await new Promise(r => setTimeout(r, 12000));

    // Send both claims concurrently
    const [r1, r2] = await Promise.all([
      api('POST', `/challenges/${c.id}/claim`, { teamId: t1.id }),
      api('POST', `/challenges/${c.id}/claim`, { teamId: t2.id }),
    ]);

    // Exactly one should succeed (200), the other should fail (400)
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);

    // Only one team should have 1000 points
    const { data: teams } = await api('GET', `/games/${game.id}/teams`);
    const scores = teams.map((t: any) => t.score).sort((a: number, b: number) => b - a);
    expect(scores).toEqual([1000, 0]);
  });

  test('rapid game creation does not produce duplicate join codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api('POST', '/games', { name: `Rapid ${i}` })
      )
    );

    const codes = results.map(r => r.data.join_code);
    const unique = new Set(codes);
    expect(unique.size).toBe(10); // All codes should be unique
  });

  test('concurrent team creation with same color — only one succeeds', async () => {
    const { data: game } = await api('POST', '/games', { name: 'Color Race' });

    const [r1, r2] = await Promise.all([
      api('POST', `/games/${game.id}/teams`, { name: 'A', color: '#e74c3c' }),
      api('POST', `/games/${game.id}/teams`, { name: 'B', color: '#e74c3c' }),
    ]);

    // One should succeed (201), the other should fail (409)
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  test('rapid challenge CRUD does not corrupt state', async () => {
    const { data: game } = await api('POST', '/games', { name: 'CRUD Stress' });

    // Create 5 challenges concurrently
    const creates = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api('POST', `/games/${game.id}/challenges`, {
          name: `Stress ${i}`, description: 'D', points: 100 + i,
          lat: 41.88 + i * 0.001, lng: -87.62,
        })
      )
    );
    expect(creates.every(r => r.status === 201)).toBe(true);

    // List should have exactly 5
    const { data: list } = await api('GET', `/games/${game.id}/challenges`);
    expect(list.length).toBe(5);

    // Delete all concurrently
    const deletes = await Promise.all(
      creates.map(r => api('DELETE', `/challenges/${r.data.id}`))
    );
    expect(deletes.every(r => r.status === 200)).toBe(true);

    // List should be empty
    const { data: empty } = await api('GET', `/games/${game.id}/challenges`);
    expect(empty.length).toBe(0);
  });
});
