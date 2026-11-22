import { expect, test } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';

async function firstAsset(): Promise<string> {
  const html = await (await fetch(`${BASE}/`)).text();
  const m = html.match(/src="(\/assets\/[^"]+)"/);
  if (!m) throw new Error('keine JS-Datei unter /assets/ gefunden');
  return m[1];
}

test.describe('level-2', () => {
  test('Antwort kommt von nginx', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('server')).toBe('nginx');
  });

  test('results.json wird nicht zwischengespeichert', async () => {
    const res = await fetch(`${BASE}/results.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('index.html wird nicht zwischengespeichert', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  test('Assets werden ein Jahr zwischengespeichert', async () => {
    const asset = await firstAsset();
    const res = await fetch(`${BASE}${asset}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  test('Fehlende Datei ergibt 404', async () => {
    const res = await fetch(`${BASE}/gibt-es-nicht.json`);
    expect(res.status).toBe(404);
  });

  test('Antworten sind gzip-komprimiert', async () => {
    const asset = await firstAsset();
    for (const path of ['/', asset, '/results.json']) {
      const res = await fetch(`${BASE}${path}`, { headers: { 'accept-encoding': 'gzip' } });
      expect(res.headers.get('content-encoding')).toBe('gzip');
    }
  });

  test('Seite funktioniert über nginx', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="board"]');
      return el && el.getAttribute('data-state') !== 'loading';
    });
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok');
    await expect(page.locator('[data-testid="level-card"]')).toHaveCount(10);
    expect(errors).toEqual([]);
  });
});
