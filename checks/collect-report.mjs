import { execFileSync } from 'node:child_process';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Lauf von "CI" für `sha` auf `main`.
 * Ergebnis: { runId, url, jobs, totalS }.
 */
export async function pipelineOf(repo, sha) {
  const raw = gh([
    'api',
    `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`,
  ]);
  const data = JSON.parse(raw);
  const runs = data.workflow_runs || [];
  if (runs.length === 0) throw new Error('kein Lauf gefunden');

  const run = runs[0];
  const runId = run.id;
  const url = run.html_url;

  const jobsRaw = gh(['api', `repos/${repo}/actions/runs/${runId}/jobs`]);
  const jobsData = JSON.parse(jobsRaw);

  const jobs = {};
  let latestCompleted = null;
  for (const j of jobsData.jobs || []) {
    if (j.started_at && j.completed_at) {
      jobs[j.name] = Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000);
      const c = Date.parse(j.completed_at);
      if (latestCompleted === null || c > latestCompleted) latestCompleted = c;
    }
  }

  const totalS = latestCompleted === null ? 0 : Math.round((latestCompleted - Date.parse(run.run_started_at)) / 1000);

  return { runId, url, jobs, totalS };
}

const ACCEPT =
  'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json';

async function getToken(name) {
  const res = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
  if (!res.ok) throw new Error(`Token: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function fetchManifest(name, token, ref) {
  const res = await fetch(`https://ghcr.io/v2/${name}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  if (!res.ok) throw new Error(`Manifest: ${res.status}`);
  return res.json();
}

/**
 * Größe des Images `ghcr.io/<name>:<tag>` in MB, ohne Anmeldung. Bei einem
 * Index zählt der Eintrag linux/amd64. Auf 1 Nachkommastelle gerundet.
 */
export async function imageSizeMB(name, tag) {
  const token = await getToken(name);

  const headRes = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  if (!headRes.ok) throw new Error(`Manifest-HEAD: ${headRes.status}`);
  const digest = headRes.headers.get('docker-content-digest');
  if (!digest) throw new Error('kein Digest');

  let manifest = await fetchManifest(name, token, digest);
  if (Array.isArray(manifest.manifests)) {
    const entry = manifest.manifests.find(
      (m) => m.platform && m.platform.os === 'linux' && m.platform.architecture === 'amd64',
    );
    if (!entry) throw new Error('kein linux/amd64-Eintrag');
    manifest = await fetchManifest(name, token, entry.digest);
  }

  const bytes = (manifest.layers || []).reduce((sum, l) => sum + (l.size || 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
