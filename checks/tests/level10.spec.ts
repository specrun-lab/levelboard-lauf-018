import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { imageSizeMB, pipelineOf } from '../collect-report.mjs';

const GITHUB_REPO = process.env.GITHUB_REPO || '';
const API_URL = process.env.API_URL || 'http://127.0.0.1:8081';
const LIVE_URL = process.env.LIVE_URL || '';
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtBuildS(s: number): string {
  const r = Math.round(s);
  if (r < 60) return `${r} s`;
  const m = Math.floor(r / 60);
  const sec = r % 60;
  return `${m}:${pad2(sec)} min`;
}

function fmtBuild(b: { buildS?: number; inLevel?: number }): string {
  if (b.inLevel != null) return `in L${pad2(b.inLevel)}`;
  return fmtBuildS(b.buildS || 0);
}

function fmt1(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

function readBericht(): any {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), '.out', 'bericht.json'), 'utf8'));
}

test.describe('level-10', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Alle Teile des Berichts sind vorhanden', async () => {
    const sha = head();
    const pipeline = await pipelineOf(GITHUB_REPO, sha);
    expect(pipeline.jobs.check).toBeGreaterThan(0);
    expect(pipeline.jobs.images).toBeGreaterThan(0);
    expect(pipeline.jobs.deploy).toBeGreaterThan(0);

    const frontendMB = await imageSizeMB(`${GITHUB_REPO}-frontend`, sha);
    const backendMB = await imageSizeMB(`${GITHUB_REPO}-backend`, sha);
    expect(frontendMB).toBeGreaterThan(0);
    expect(backendMB).toBeGreaterThan(0);

    const loadtestPath = path.join(process.cwd(), '.out', 'loadtest.json');
    expect(fs.existsSync(loadtestPath)).toBe(true);
    const loadtest = JSON.parse(fs.readFileSync(loadtestPath, 'utf8'));
    expect(loadtest.requests).toBeGreaterThan(0);

    const build: Record<string, unknown> = {};
    const bauzeitPath = path.join(PROJECT_ROOT, 'bauzeit.json');
    if (fs.existsSync(bauzeitPath)) {
      const b = JSON.parse(fs.readFileSync(bauzeitPath, 'utf8'));
      for (const [k, v] of Object.entries(b.levels || {})) build[k] = v;
    }
    for (let i = 1; i <= 10; i++) {
      if (!build[String(i)]) {
        build[String(i)] = { passedAt: new Date().toISOString(), buildS: 1 };
      }
    }

    const bericht = { pipeline, images: { frontendMB, backendMB }, loadtest, build };
    const outDir = path.join(process.cwd(), '.out');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'bericht.json'), JSON.stringify(bericht));
  });

  test('Vollständiger Bericht wird dargestellt', async ({ page }) => {
    const bericht = readBericht();
    const now = new Date().toISOString();

    const exampleUsage: Record<string, unknown> = {
      harness: 'claude',
      models: ['claude-haiku-5-5'],
      measuredAt: now,
      total: { output: 812345, total: 23456789, costUsd: 2.04 },
      levels: {},
    };
    const usageLevels: Record<string, unknown> = {};
    for (let i = 1; i <= 10; i++) {
      const b = bericht.build[String(i)] as { inLevel?: number } | undefined;
      if (b && b.inLevel != null) usageLevels[String(i)] = { inLevel: b.inLevel };
      else usageLevels[String(i)] = { output: 1000 + i, total: 9000 + i, costUsd: 0.42 };
    }
    exampleUsage.levels = usageLevels;

    await page.route('**/api/levels', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.levels = data.levels.map((l: { title: string }, idx: number) => ({
        level: idx + 1,
        title: l.title,
        status: 'bestanden',
        checkedAt: now,
        durationMs: 100,
        checks: [{ name: 'x', ok: true }],
        metrics: { build: bericht.build[String(idx + 1)] || { passedAt: now, buildS: 1 } },
      }));
      data.levels[5].metrics.pipeline = bericht.pipeline;
      data.levels[6].metrics.images = bericht.images;
      data.levels[8].metrics.loadtest = bericht.loadtest;
      data.run.updatedAt = now;
      await route.fulfill({ response: real, json: data });
    });

    await page.route('**/api/usage', async (route) => {
      const real = await route.fetch();
      await route.fulfill({ response: real, json: exampleUsage });
    });

    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });

    await expect(page.locator('[data-testid="report"]')).toHaveAttribute('data-complete', 'true');
    await expect(page.locator('[data-testid="report-reached"]')).toHaveText('10 / 10');
    await expect(page.locator('[data-testid="report-complete"]')).toHaveText('ja');

    const totalBuildS = Object.values(bericht.build).reduce(
      (s: number, b) => s + ((b as { buildS?: number }).buildS || 0),
      0,
    );
    await expect(page.locator('[data-testid="report-build-time"]')).toHaveText(fmtBuildS(totalBuildS));

    await expect(page.locator('[data-testid="report-p95"]')).toHaveText(`${bericht.loadtest.p95Ms} ms`);
    await expect(page.locator('[data-testid="report-image-frontend"]')).toHaveText(
      `${fmt1(bericht.images.frontendMB)} MB`,
    );
    await expect(page.locator('[data-testid="report-job-check"]')).toHaveText(
      `${bericht.pipeline.jobs.check} s`,
    );
    await expect(page.locator('[data-testid="report-job-images"]')).toHaveText(
      `${bericht.pipeline.jobs.images} s`,
    );
    await expect(page.locator('[data-testid="report-job-deploy"]')).toHaveText(
      `${bericht.pipeline.jobs.deploy} s`,
    );
    await expect(page.locator('[data-testid="report-pipeline-link"]')).toHaveAttribute(
      'href',
      bericht.pipeline.url,
    );

    for (let i = 1; i <= 10; i++) {
      const b = bericht.build[String(i)] as { buildS?: number; inLevel?: number } | undefined;
      const expected = b ? fmtBuild(b) : '–';
      await expect(
        page.locator(`[data-testid="level-card"][data-level="${i}"] [data-testid="level-build-time"]`),
      ).toHaveText(expected);
    }

    await expect(page.locator('[data-testid="report-harness"]')).toHaveText('claude');
    await expect(page.locator('[data-testid="report-model"]')).toHaveText('claude-haiku-5-5');
    await expect(page.locator('[data-testid="report-tokens-output"]')).toHaveText(
      (812345).toLocaleString('de-CH'),
    );
    await expect(page.locator('[data-testid="report-tokens-total"]')).toHaveText(
      (23456789).toLocaleString('de-CH'),
    );
    await expect(page.locator('[data-testid="report-cost"]')).toHaveText('2,04 USD');

    for (let i = 1; i <= 10; i++) {
      const e = usageLevels[String(i)] as { inLevel?: number; output?: number; costUsd?: number };
      let cost: string;
      let output: string;
      if (e.inLevel != null) {
        cost = `in L${pad2(e.inLevel)}`;
        output = `in L${pad2(e.inLevel)}`;
      } else {
        cost = `${(e.costUsd as number).toFixed(2).replace('.', ',')} USD`;
        output = (e.output as number).toLocaleString('de-CH');
      }
      await expect(
        page.locator(`[data-testid="report-level"][data-level="${i}"] [data-testid="report-level-cost"]`),
      ).toHaveText(cost);
      await expect(
        page.locator(
          `[data-testid="report-level"][data-level="${i}"] [data-testid="report-level-output"]`,
        ),
      ).toHaveText(output);
    }
  });

  test('Teilbericht zeigt fehlende Teile', async ({ page }) => {
    const now = new Date().toISOString();

    await page.route('**/api/levels', async (route) => {
      const real = await route.fetch();
      const data = await real.json();
      data.levels = data.levels.map((l: { title: string }, idx: number) => {
        if (idx < 2) {
          return {
            level: idx + 1,
            title: l.title,
            status: 'bestanden',
            checkedAt: now,
            durationMs: 100,
            checks: [{ name: 'x', ok: true }],
            metrics: { build: { passedAt: now, buildS: 42 } },
          };
        }
        return {
          level: idx + 1,
          title: l.title,
          status: 'offen',
          checkedAt: null,
          durationMs: null,
          checks: [],
          metrics: {},
        };
      });
      data.run.updatedAt = now;
      await route.fulfill({ response: real, json: data });
    });

    await page.route('**/api/usage', async (route) => {
      const real = await route.fetch();
      await route.fulfill({ response: real, json: {} });
    });

    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });

    await expect(page.locator('[data-testid="report"]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-testid="report-reached"]')).toHaveText('2 / 10');
    await expect(page.locator('[data-testid="report-complete"]')).toHaveText('nein');
    await expect(page.locator('[data-testid="report-build-time"]')).toHaveText('1:24 min');
    await expect(page.locator('[data-testid="report-pipeline-missing"]')).toHaveText(
      'noch nicht erreicht',
    );
    await expect(page.locator('[data-testid="report-images-missing"]')).toHaveText(
      'noch nicht erreicht',
    );
    await expect(page.locator('[data-testid="report-loadtest-missing"]')).toHaveText(
      'noch nicht erreicht',
    );
    await expect(page.locator('[data-testid="report-tokens-missing"]')).toHaveText(
      'wird nach der Prüfung ergänzt',
    );
    for (let i = 1; i <= 10; i++) {
      await expect(
        page.locator(`[data-testid="report-level"][data-level="${i}"] [data-testid="report-level-cost"]`),
      ).toHaveText('–');
      await expect(
        page.locator(
          `[data-testid="report-level"][data-level="${i}"] [data-testid="report-level-output"]`,
        ),
      ).toHaveText('–');
    }
  });

  test('Verbrauch wird gespeichert und gelesen', async () => {
    const beforeRes = await fetch(`${API_URL}/api/usage`);
    const beforeText = beforeRes.ok ? await beforeRes.text() : '{}';

    const example = {
      harness: 'claude',
      models: ['claude-haiku-5-5'],
      measuredAt: new Date().toISOString(),
      total: { output: 1, total: 2, costUsd: 3.5 },
    };

    try {
      const putRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(example),
      });
      expect(putRes.status).toBe(200);
      expect(await putRes.json()).toEqual(example);

      const getRes = await fetch(`${API_URL}/api/usage`);
      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual(example);

      const arrRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '[1,2]',
      });
      expect(arrRes.status).toBe(400);

      const brokenRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{kaputt',
      });
      expect(brokenRes.status).toBe(400);

      const ctRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'text/plain' },
        body: '{}',
      });
      expect(ctRes.status).toBe(415);

      const bigRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'a'.repeat(65537),
      });
      expect(bigRes.status).toBe(413);

      const postRes = await fetch(`${API_URL}/api/usage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(postRes.status).toBe(405);
      expect(postRes.headers.get('allow') || '').toContain('PUT');

      const stillRes = await fetch(`${API_URL}/api/usage`);
      expect(await stillRes.json()).toEqual(example);

      const clearRes = await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(clearRes.status).toBe(200);
      expect(await clearRes.json()).toEqual({});
    } finally {
      await fetch(`${API_URL}/api/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: beforeText,
      });
    }
  });
});
