import fs from 'node:fs';

/**
 * Meldet die Levels aus einer results.json aufsteigend an die Live-API.
 * Aufruf: node report-live.mjs <results.json> <basis-url>
 */
const [resultsPath, baseUrl] = process.argv.slice(2);

if (!resultsPath || !baseUrl) {
  console.error('Aufruf: node report-live.mjs <results.json> <basis-url>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

let reported = 0;
for (const lvl of data.levels) {
  if (lvl.status !== 'bestanden' && lvl.status !== 'fehlgeschlagen') break;
  if (!lvl.checks || lvl.checks.length === 0) break;

  const res = await fetch(`${baseUrl}/api/levels/${lvl.level}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checks: lvl.checks, durationMs: lvl.durationMs, metrics: lvl.metrics }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Meldung an die Live-API für Level ${lvl.level} fehlgeschlagen: ${res.status} ${text}`);
    process.exit(1);
  }

  reported++;
  if (lvl.status === 'fehlgeschlagen') break;
}

if (reported === 0) {
  console.error('nichts gemeldet');
  process.exit(1);
}
