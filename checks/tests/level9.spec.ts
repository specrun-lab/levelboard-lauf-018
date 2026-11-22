import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadtest } from '../loadtest.mjs';

const RUN_ID = process.env.RUN_ID || '';
const LIVE_URL = process.env.LIVE_URL || '';

test.describe('level-9', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Live-Seite zeigt Kopfzeile und 10 Karten', async ({ page }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);
    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="run-id"]')).toHaveText(RUN_ID);
    await expect(page.locator('[data-testid="run-commit"]')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.locator('[data-testid="level-card"]')).toHaveCount(10);
  });

  test('Cache- und gzip-Regeln gelten live', async () => {
    const root = await fetch(`${LIVE_URL}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(root.status).toBe(200);
    expect(root.headers.get('cache-control')).toBe('no-cache');
    expect(root.headers.get('content-encoding')).toBe('gzip');

    const html = await root.text();
    const m = html.match(/src="(\/assets\/[^"]+)"/);
    expect(m).not.toBeNull();
    const assetRes = await fetch(`${LIVE_URL}${m![1]}`);
    expect(assetRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const cfg = await fetch(`${LIVE_URL}/config.json`);
    expect(cfg.headers.get('cache-control')).toBe('no-store');

    const missing = await fetch(`${LIVE_URL}/gibt-es-nicht.json`);
    expect(missing.status).toBe(404);
  });

  test('Live-API antwortet laut Spec', async () => {
    const health = await fetch(`${LIVE_URL}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toBe('application/json');

    const levels = await fetch(`${LIVE_URL}/api/levels`);
    expect(levels.status).toBe(200);
    const levelsBody = await levels.json();
    expect(levelsBody.levels).toHaveLength(10);

    const unknown = await fetch(`${LIVE_URL}/api/levels/0`);
    expect(unknown.status).toBe(404);
    const unknownBody = await unknown.json();
    expect(typeof unknownBody.error).toBe('string');

    const del = await fetch(`${LIVE_URL}/api/levels`, { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(del.headers.get('allow')).toBe('GET');

    const badPost = await fetch(`${LIVE_URL}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [] }),
    });
    expect(badPost.status).toBe(400);

    const badCt = await fetch(`${LIVE_URL}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ checks: [], durationMs: 1 }),
    });
    expect(badCt.status).toBe(415);
  });

  test('Meldung erscheint live ohne Neuladen', async ({ page }) => {
    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });

    const res = await fetch(`${LIVE_URL}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 }),
    });
    expect(res.status).toBe(200);

    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.locator('[data-testid="level-duration"]')).toHaveText('4,2 s', { timeout: 8000 });

    const hist = await (await fetch(`${LIVE_URL}/api/levels/1/history?limit=1`)).json();
    expect(hist.entries[0].checks).toEqual([{ name: 'Live-Probe', ok: true }]);
  });

  test('Lasttest: 10 Verbindungen, 30 s, ohne Fehler, p95 unter 1 s', async () => {
    const result = await loadtest(LIVE_URL.replace(/\/$/, ''));

    const outDir = path.join(process.cwd(), '.out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'loadtest.json'), JSON.stringify(result));

    expect(result.requests).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    expect(result.p95Ms).toBeLessThan(1000);
  });
});
