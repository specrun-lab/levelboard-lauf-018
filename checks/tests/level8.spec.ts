import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const GITHUB_REPO = process.env.GITHUB_REPO || '';
const RUN_ID = process.env.RUN_ID || '';
const LIVE_URL = process.env.LIVE_URL || '';
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function head(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

test.describe('level-8', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job deploy des letzten Laufs ist grün', () => {
    const sha = head();
    const runsRaw = gh([
      'api',
      `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
    ]);
    const run = JSON.parse(runsRaw).workflow_runs[0];

    const jobsRaw = gh(['api', `repos/${GITHUB_REPO}/actions/runs/${run.id}/jobs`]);
    const jobs = JSON.parse(jobsRaw).jobs;
    const deploy = jobs.find((j: { name: string }) => j.name === 'deploy');
    expect(deploy).toBeTruthy();
    expect(deploy.conclusion).toBe('success');
  });

  test('Live-Seite antwortet über HTTPS', async ({ page }) => {
    expect(LIVE_URL.startsWith('https://')).toBe(true);

    const res = await fetch(`${LIVE_URL}/`);
    expect(res.status).toBe(200);

    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="run-source"]')).toHaveAttribute('data-source', 'api');
  });

  test('Live-Seite meldet den aktuellen Commit', async ({ page }) => {
    const sha = head();
    const res = await fetch(`${LIVE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit).toBe(sha);

    await page.goto(LIVE_URL);
    await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-state', 'ok', {
      timeout: 30000,
    });
    await expect(page.locator('[data-testid="run-commit"]')).toHaveText(sha.slice(0, 7));
  });

  test('Live-Seite zeigt die Ergebnisse der Pipeline', async () => {
    const res = await fetch(`${LIVE_URL}/api/levels`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.id).toBe(RUN_ID);
    for (let i = 1; i <= 5; i++) {
      expect(body.levels[i - 1].status).toBe('bestanden');
    }
  });
});
