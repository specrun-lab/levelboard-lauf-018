import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const API = process.env.API_URL || 'http://127.0.0.1:8081';
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

async function post(level: number, durationMs: number, ok: boolean) {
  return fetch(`${API}/api/levels/${level}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checks: [{ name: 'a', ok }], durationMs }),
  });
}

test.describe('level-4', () => {
  test.describe.configure({ mode: 'serial' });

  test('Meldungen erscheinen in der Historie, neueste zuerst', async () => {
    await post(1, 101, true);
    await post(1, 102, true);
    const res = await fetch(`${API}/api/levels/1/history`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level).toBe(1);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0].durationMs).toBe(102);
    expect(body.entries[1].durationMs).toBe(101);
    expect(body.entries[0].id).toBeGreaterThan(body.entries[1].id);
    expect(body.entries[0].status).toBe('bestanden');
  });

  test('Historie begrenzt mit limit', async () => {
    const res1 = await fetch(`${API}/api/levels/1/history?limit=1`);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.entries).toHaveLength(1);

    for (const limit of ['0', '501']) {
      const res = await fetch(`${API}/api/levels/1/history?limit=${limit}`);
      expect(res.status).toBe(400);
    }
  });

  test('Daten überstehen einen Neustart des Backends', async () => {
    const historyBefore = await (await fetch(`${API}/api/levels/1/history?limit=500`)).json();
    const levelsBefore = await (await fetch(`${API}/api/levels`)).json();

    await new Promise<void>((resolve, reject) => {
      execFile('make', ['restart-backend'], { cwd: PROJECT_ROOT }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const historyAfter = await (await fetch(`${API}/api/levels/1/history?limit=500`)).json();
    const levelsAfter = await (await fetch(`${API}/api/levels`)).json();
    expect(historyAfter).toEqual(historyBefore);
    expect(levelsAfter).toEqual(levelsBefore);
  });

  test('Abgelehnte Meldungen landen nicht in der Historie', async () => {
    await post(1, 103, false);
    const before = await (await fetch(`${API}/api/levels/2/history?limit=500`)).json();
    const beforeCount = before.entries.length;

    const res = await post(2, 104, true);
    expect(res.status).toBe(409);

    const after = await (await fetch(`${API}/api/levels/2/history?limit=500`)).json();
    expect(after.entries.length).toBe(beforeCount);
  });

  test('Datenbank hat das vorgegebene Schema', async () => {
    test.setTimeout(30_000);
    const dbPath = path.join(PROJECT_ROOT, '.run', 'levelboard.db');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const uv = db.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(uv.user_version).toBe(1);

      const tableInfo = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name);

      expect(tableInfo('levels')).toEqual(['level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(tableInfo('reports')).toEqual(['id', 'level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(tableInfo('meta')).toEqual(['key', 'value']);

      const count = db.prepare('SELECT COUNT(*) AS c FROM levels').get() as { c: number };
      expect(count.c).toBe(10);
    } finally {
      db.close();
    }
  });
});
