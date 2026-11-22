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

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function head(): string {
  return git(['rev-parse', 'HEAD']).trim();
}

test.describe('level-6', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Repo existiert und ist öffentlich', () => {
    const raw = gh(['api', `repos/${GITHUB_REPO}`]);
    const repo = JSON.parse(raw);
    expect(repo.full_name).toBe(GITHUB_REPO);
    expect(repo.visibility).toBe('public');
    expect(repo.default_branch).toBe('main');
  });

  test('Lokaler Stand ist gepusht', () => {
    const status = git(['status', '--porcelain']);
    expect(status.trim()).toBe('');

    const localHead = head();
    const raw = gh(['api', `repos/${GITHUB_REPO}/branches/main`]);
    const branch = JSON.parse(raw);
    expect(localHead).toBe(branch.commit.sha);
  });

  test('Letzter Pipeline-Lauf ist grün', () => {
    const sha = head();
    const raw = gh([
      'api',
      `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
    ]);
    const data = JSON.parse(raw);
    expect(data.total_count).toBeGreaterThan(0);
    const run = data.workflow_runs[0];
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });

  test('Report enthält Level 1–5 bestanden', () => {
    const sha = head();
    const raw = gh([
      'api',
      `repos/${GITHUB_REPO}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
    ]);
    const run = JSON.parse(raw).workflow_runs[0];

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-report-'));
    gh(['run', 'download', String(run.id), '--repo', GITHUB_REPO, '--name', 'levelboard-report', '--dir', dir]);

    const candidates = [path.join(dir, 'results.json'), path.join(dir, 'frontend', 'dist', 'results.json')];
    let found: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        found = c;
        break;
      }
    }
    expect(found).not.toBeNull();
    const data = JSON.parse(fs.readFileSync(found as string, 'utf8'));
    for (let i = 1; i <= 5; i++) {
      expect(data.levels[i - 1].status).toBe('bestanden');
      expect(data.levels[i - 1].checks.length).toBeGreaterThan(0);
    }
  });
});
