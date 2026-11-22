import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';

const API = process.env.API_URL || 'http://127.0.0.1:8081';

test.describe('level-3', () => {
  test.describe.configure({ mode: 'serial' });

  test('Backend antwortet auf /api/health', async () => {
    const res = await fetch(`${API}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.commit).toBeNull();
  });

  test('GET /api/levels liefert alle 10 Levels im Schema', async () => {
    const res = await fetch(`${API}/api/levels`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['levels', 'run']);
    expect(body.levels).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(body.levels[i].level).toBe(i + 1);
      expect(['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt']).toContain(body.levels[i].status);
      expect(Array.isArray(body.levels[i].checks)).toBe(true);
    }
  });

  test('Ergebnis melden setzt Status und Zeitpunkt', async () => {
    const res = await fetch(`${API}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'a', ok: true }], durationMs: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.levels[0].status).toBe('bestanden');
    expect(Number.isNaN(Date.parse(body.levels[0].checkedAt))).toBe(false);
    expect(body.levels[0].durationMs).toBe(10);
  });

  test('Fehlschlag sperrt höhere Levels', async () => {
    const res = await fetch(`${API}/api/levels/1/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'a', ok: false }], durationMs: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.levels[0].status).toBe('fehlgeschlagen');
    for (let i = 1; i < 10; i++) {
      expect(body.levels[i].status).toBe('gesperrt');
    }
  });

  test('Falsche Reihenfolge ergibt 409', async () => {
    const res = await fetch(`${API}/api/levels/2/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checks: [{ name: 'a', ok: true }], durationMs: 10 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  test('Ungültige Anfragen ergeben 400', async () => {
    const cases = ['{kaputt', '{}', '{"checks":[]}'];
    for (const body of cases) {
      const res = await fetch(`${API}/api/levels/1/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(typeof data.error).toBe('string');
    }
  });

  test('Unbekanntes Level ergibt 404', async () => {
    for (const p of ['0', '11', 'abc']) {
      const res = await fetch(`${API}/api/levels/${p}`);
      expect(res.status).toBe(404);
    }
  });

  test('Go-Tests bestehen', async () => {
    test.setTimeout(180_000);
    const cwd = path.resolve(process.cwd(), '..', 'backend');
    await new Promise<void>((resolve, reject) => {
      execFile('go', ['test', '-count=1', './...'], { cwd }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`go test fehlgeschlagen:\n${stdout}\n${stderr}`));
        } else {
          resolve();
        }
      });
    });
  });
});
