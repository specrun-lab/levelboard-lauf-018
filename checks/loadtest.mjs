import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Lasttest: 10 gleichzeitige Verbindungen, 30 s, nur fetch.
 * Ergebnis: { connections, durationS, requests, errors, rps, p50Ms, p95Ms, maxMs }.
 */
export async function loadtest(base) {
  const durationMs = 30000;
  const connections = 10;
  const start = performance.now();
  const endAt = start + durationMs;

  const times = [];
  let requests = 0;
  let errors = 0;

  async function worker(i) {
    let pathName = '/';
    while (performance.now() < endAt) {
      const t0 = performance.now();
      let ok = true;
      try {
        const res = await fetch(base + pathName, { signal: AbortSignal.timeout(10000) });
        await res.arrayBuffer();
        if (res.status !== 200) ok = false;
      } catch {
        ok = false;
      }
      const t1 = performance.now();
      times.push(t1 - t0);
      requests++;
      if (!ok) errors++;
      pathName = pathName === '/' ? '/api/levels' : '/';
    }
  }

  await Promise.all(Array.from({ length: connections }, (_, i) => worker(i)));

  const elapsedS = (performance.now() - start) / 1000;
  const sorted = [...times].sort((a, b) => a - b);

  function percentile(p) {
    if (sorted.length === 0) return 0;
    const rank = Math.ceil((p / 100) * sorted.length);
    return Math.round(sorted[rank - 1]);
  }

  return {
    connections,
    durationS: 30,
    requests,
    errors,
    rps: Math.round((requests / elapsedS) * 10) / 10,
    p50Ms: percentile(50),
    p95Ms: percentile(95),
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : 0,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const base = process.argv[2];
  if (!base) {
    console.error('Aufruf: node loadtest.mjs <basis-url>');
    process.exit(1);
  }
  const result = await loadtest(base);
  console.log(JSON.stringify(result));
}
