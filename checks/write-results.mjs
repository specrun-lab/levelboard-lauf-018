import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { updateBauzeit } from './bauzeit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PLAYWRIGHT_JSON = path.join(__dirname, '.out', 'playwright.json');
const DIST_RESULTS = path.join(PROJECT_ROOT, 'frontend', 'dist', 'results.json');
const LOADTEST_JSON = path.join(__dirname, '.out', 'loadtest.json');

const levels = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
if (levels.length === 0) {
  console.error('Aufruf: node write-results.mjs <level> [<level> …]');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(PLAYWRIGHT_JSON, 'utf8'));

function collectChecks(report, level) {
  const groupTitle = `level-${level}`;
  const specs = [];
  const walk = (suites) => {
    for (const s of suites || []) {
      if (s.title === groupTitle && Array.isArray(s.specs)) specs.push(...s.specs);
      if (Array.isArray(s.suites)) walk(s.suites);
    }
  };
  walk(report.suites);

  if (specs.length === 0) return null;

  const checks = [];
  let duration = 0;
  for (const spec of specs) {
    const allExpected = (spec.tests || []).every(
      (t) => t.status === 'expected' || t.status === 'flaky',
    );
    const ok = spec.ok === true && allExpected;
    checks.push({ name: spec.title, ok });
    for (const t of spec.tests || []) {
      for (const r of t.results || []) {
        duration += r.duration || 0;
      }
    }
  }
  return { checks, duration: Math.round(duration) };
}

const collected = {};
for (const n of levels) {
  const c = collectChecks(report, n);
  if (!c) {
    console.error(`Keine Checks für Level ${n} gefunden.`);
    process.exit(1);
  }
  collected[n] = c;
}

const data = JSON.parse(fs.readFileSync(DIST_RESULTS, 'utf8'));
const now = new Date().toISOString();
const sortedLevels = [...levels].sort((a, b) => a - b);

let failed = false;
let processedUpTo = 0;
for (const n of sortedLevels) {
  const c = collected[n];
  const ok = c.checks.every((ch) => ch.ok);
  const lvl = data.levels[n - 1];
  lvl.status = ok ? 'bestanden' : 'fehlgeschlagen';
  lvl.checkedAt = now;
  lvl.durationMs = c.duration;
  lvl.checks = c.checks;
  processedUpTo = n;
  if (!ok) {
    failed = true;
    break;
  }
}

for (let i = processedUpTo + 1; i <= 10; i++) {
  const lvl = data.levels[i - 1];
  lvl.status = failed ? 'gesperrt' : 'offen';
  lvl.checkedAt = null;
  lvl.durationMs = null;
  lvl.checks = [];
  lvl.metrics = {};
}

data.run.updatedAt = now;
if (process.env.RUN_ID) data.run.id = process.env.RUN_ID;

// Erreichtes Level in diesem Lauf
let reached = 0;
for (const lvl of data.levels) {
  if (lvl.status === 'bestanden' && lvl.level === reached + 1) reached = lvl.level;
  else break;
}

// Bauzeit ergänzen
const bauzeitLevels = updateBauzeit(reached, now);

// Kennzahlen pro Level
for (let n = 1; n <= processedUpTo; n++) {
  const lvl = data.levels[n - 1];
  const metrics = {};
  if (bauzeitLevels[String(n)]) metrics.build = bauzeitLevels[String(n)];
  lvl.metrics = metrics;
}

// pipeline (Level 6), images (Level 7), loadtest (Level 9)
let collectReport = null;
try {
  collectReport = await import('./collect-report.mjs');
} catch {
  collectReport = null;
}

function currentHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const l6 = data.levels[5];
if (l6.status === 'bestanden' && collectReport) {
  const repo = process.env.GITHUB_REPO;
  const head = currentHead();
  if (repo && head) {
    try {
      l6.metrics.pipeline = await collectReport.pipelineOf(repo, head);
    } catch (e) {
      console.error(`Kennzahl pipeline nicht ermittelbar: ${e.message}`);
    }
  }
}

const l7 = data.levels[6];
if (l7.status === 'bestanden' && collectReport) {
  const repo = process.env.GITHUB_REPO;
  const head = currentHead();
  if (repo && head) {
    try {
      const frontendMB = await collectReport.imageSizeMB(`${repo}-frontend`, head);
      const backendMB = await collectReport.imageSizeMB(`${repo}-backend`, head);
      l7.metrics.images = { frontendMB, backendMB };
    } catch (e) {
      console.error(`Kennzahl images nicht ermittelbar: ${e.message}`);
    }
  }
}

const l9 = data.levels[8];
if (l9.status === 'bestanden' && fs.existsSync(LOADTEST_JSON)) {
  try {
    l9.metrics.loadtest = JSON.parse(fs.readFileSync(LOADTEST_JSON, 'utf8'));
  } catch (e) {
    console.error(`Kennzahl loadtest nicht ermittelbar: ${e.message}`);
  }
}

fs.writeFileSync(DIST_RESULTS, JSON.stringify(data, null, 2) + '\n');

for (const n of sortedLevels) {
  const lvl = data.levels[n - 1];
  const okCount = lvl.checks.filter((c) => c.ok).length;
  const total = lvl.checks.length;
  const suffix = total === 0 ? '' : ` (${okCount}/${total} Checks)`;
  console.log(`Level ${n}: ${lvl.status}${suffix}`);
}

// Melden an das Backend (REPORT_API=1) und an die Live-API (REPORT_LIVE=1)
let reportOk = true;

async function reportTo(baseUrl, prefix) {
  for (const n of sortedLevels) {
    const lvl = data.levels[n - 1];
    if (lvl.status !== 'bestanden' && lvl.status !== 'fehlgeschlagen') break;
    if (lvl.checks.length === 0) break;
    try {
      const res = await fetch(`${baseUrl}/api/levels/${n}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ checks: lvl.checks, durationMs: lvl.durationMs, metrics: lvl.metrics }),
      });
      if (res.status !== 200) {
        const text = await res.text();
        console.log(`Meldung ${prefix} für Level ${n} fehlgeschlagen: ${res.status} ${text}`);
        return false;
      }
      console.log(`Level ${n} ${prefix} gemeldet`);
    } catch (e) {
      console.log(`Meldung ${prefix} für Level ${n} fehlgeschlagen: ${e.message}`);
      return false;
    }
    if (lvl.status === 'fehlgeschlagen') break;
  }
  return true;
}

if (process.env.REPORT_API === '1') {
  const apiUrl = process.env.API_URL || 'http://127.0.0.1:8081';
  const ok = await reportTo(apiUrl, 'an das Backend');
  if (!ok) reportOk = false;
}

if (process.env.REPORT_LIVE === '1' && process.env.LIVE_URL) {
  const ok = await reportTo(process.env.LIVE_URL, 'an die Live-API');
  if (!ok) reportOk = false;
}

process.exit(failed || !reportOk ? 1 : 0);
