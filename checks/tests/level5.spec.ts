import { expect, test } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const API = process.env.API_URL || 'http://127.0.0.1:8081';

test.describe('level-5', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite liest aus dem Backend', async ({ page }) => {
    const res = await fetch(`${BASE}/config.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'api' });

    await page.goto('/');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="run-source"]')).toHaveAttribute('data-source', 'api');
    await expect(page.locator('[data-testid="run-source"]')).toHaveText('Backend');
  });

  test('nginx leitet /api/ an das Backend weiter', async () => {
    const viaProxy = await fetch(`${BASE}/api/health`);
    expect(viaProxy.status).toBe(200);
    expect(viaProxy.headers.get('content-type')).toBe('application/json');
    const proxyBody = await viaProxy.json();

    const direct = await fetch(`${API}/api/health`);
    const directBody = await direct.json();
    expect(proxyBody).toEqual(directBody);

    const unknown = await fetch(`${BASE}/api/unbekannt`);
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(typeof unknownBody.error).toBe('string');
  });

  test('Gemeldetes Ergebnis erscheint ohne Neuladen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 8000,
    });

    const res = await fetch(`${BASE}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'x', ok: true }], durationMs: 4242 }),
    });
    expect(res.status).toBe(200);

    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card).toHaveAttribute('data-status', 'bestanden', { timeout: 8000 });
    await expect(card.locator('[data-testid="level-duration"]')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Backend-Ausfall wird angezeigt', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 8000,
    });

    await page.route('**/api/levels', (route) =>
      route.fulfill({ status: 502, contentType: 'text/html', body: '<html>error</html>' }),
    );

    await expect(page.locator('[data-testid="notice"]')).toHaveAttribute('data-kind', 'unavailable', {
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="level-card"]')).toHaveCount(10);
    for (let i = 1; i <= 10; i++) {
      await expect(page.locator(`[data-testid="level-card"][data-level="${i}"]`)).toHaveAttribute(
        'data-status',
        'offen',
      );
    }

    await page.unroute('**/api/levels');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 8000,
    });
  });

  test('Meldungen über nginx landen in der Historie', async () => {
    const res = await fetch(`${BASE}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        checks: [{ name: 'Probe über nginx', ok: true }],
        durationMs: 5151,
      }),
    });
    expect(res.status).toBe(200);

    const histRes = await fetch(`${BASE}/api/levels/1/history?limit=1`);
    expect(histRes.status).toBe(200);
    const body = await histRes.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].durationMs).toBe(5151);
    expect(body.entries[0].checks).toEqual([{ name: 'Probe über nginx', ok: true }]);
  });
});
