import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileP = promisify(execFile);
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

async function compose(args: string[]): Promise<string> {
  const { stdout } = await execFileP('docker', ['compose', ...args], { cwd: PROJECT_ROOT });
  return stdout;
}

test.describe('container', () => {
  test.describe.configure({ mode: 'serial' });

  test('Seite läuft im Container und liest aus dem Backend', async ({ page }) => {
    const res = await fetch(`${BASE}/config.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'api' });

    await page.goto('/');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 15000,
    });
    await expect(page.locator('[data-testid="run-source"]')).toHaveAttribute('data-source', 'api');
  });

  test('/api/ wird an den Backend-Container weitergeleitet', async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body.status).toBe('ok');

    const unknown = await fetch(`${BASE}/api/unbekannt`);
    expect(unknown.status).toBe(404);
  });

  test('Meldung erscheint ohne Neuladen', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 15000,
    });

    const res = await fetch(`${BASE}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'x', ok: true }], durationMs: 4242 }),
    });
    expect(res.status).toBe(200);

    const card = page.locator('[data-testid="level-card"][data-level="1"]');
    await expect(card.locator('[data-testid="level-duration"]')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Daten überstehen einen Neustart des Backend-Containers', async () => {
    const beforeRes = await fetch(`${BASE}/api/levels/1/history?limit=500`);
    const before = await beforeRes.json();
    expect(before.entries.length).toBeGreaterThan(0);

    await compose(['restart', 'backend']);

    let ok = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.status === 200) {
          ok = true;
          break;
        }
      } catch {
        // noch nicht erreichbar
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(ok).toBe(true);

    const afterRes = await fetch(`${BASE}/api/levels/1/history?limit=500`);
    const after = await afterRes.json();
    expect(after).toEqual(before);
  });

  test('Cache- und gzip-Regeln gelten im Container', async () => {
    const root = await fetch(`${BASE}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(root.headers.get('cache-control')).toBe('no-cache');
    expect(root.headers.get('content-encoding')).toBe('gzip');
    expect(root.headers.get('server')).toBe('nginx');

    const html = await root.text();
    const m = html.match(/src="(\/assets\/[^"]+)"/);
    expect(m).not.toBeNull();
    const asset = m![1];
    const assetRes = await fetch(`${BASE}${asset}`);
    expect(assetRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const cfg = await fetch(`${BASE}/config.json`);
    expect(cfg.headers.get('cache-control')).toBe('no-store');

    const missing = await fetch(`${BASE}/gibt-es-nicht.json`);
    expect(missing.status).toBe(404);
  });

  test('Backend-Container läuft nicht als root', async () => {
    const out = (await compose(['exec', '-T', 'backend', 'id', '-u'])).trim();
    expect(out).not.toBe('0');
  });
});
