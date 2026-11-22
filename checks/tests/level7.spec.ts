import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GITHUB_REPO = process.env.GITHUB_REPO || '';
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

const ACCEPT =
  'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

async function ghcrManifest(name: string, ref: string): Promise<Response> {
  const tokenRes = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
  const token = (await tokenRes.json()).token;
  return fetch(`https://ghcr.io/v2/${name}/manifests/${ref}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
}

test.describe('level-7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job images des letzten Laufs ist grün', () => {
    const sha = head();
    const runsRaw = gh([
      'api',
      `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
    ]);
    const run = JSON.parse(runsRaw).workflow_runs[0];

    const jobsRaw = gh(['api', `repos/${GITHUB_REPO}/actions/runs/${run.id}/jobs`]);
    const jobs = JSON.parse(jobsRaw).jobs;
    const images = jobs.find((j: { name: string }) => j.name === 'images');
    expect(images).toBeTruthy();
    expect(images.conclusion).toBe('success');
  });

  test('Beide Images liegen öffentlich in der GHCR', async () => {
    const sha = head();
    for (const teil of ['frontend', 'backend']) {
      const res = await ghcrManifest(`${GITHUB_REPO}-${teil}`, sha);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    }
  });

  test('Report der Container-Suite enthält nur bestandene Checks', () => {
    const sha = head();
    const runsRaw = gh([
      'api',
      `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
    ]);
    const run = JSON.parse(runsRaw).workflow_runs[0];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-container-'));
    gh(['run', 'download', String(run.id), '--repo', GITHUB_REPO, '--name', 'levelboard-container-report', '--dir', dir]);

    const reportPath = path.join(dir, 'playwright.json');
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    const specs: Array<{ ok: boolean }> = [];
    const walk = (suites: unknown) => {
      for (const s of (suites as Array<{ title: string; suites?: unknown; specs?: unknown[] }>) || []) {
        if (s.title === 'container' && Array.isArray(s.specs)) specs.push(...s.specs);
        if (s.suites) walk(s.suites);
      }
    };
    walk(report.suites);
    expect(specs.length).toBeGreaterThanOrEqual(6);
    for (const spec of specs) {
      expect(spec.ok).toBe(true);
    }
  });
});
