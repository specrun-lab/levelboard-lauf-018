import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BAUZEIT_PATH = path.join(PROJECT_ROOT, 'bauzeit.json');

export function readBauzeit() {
  let data;
  if (fs.existsSync(BAUZEIT_PATH)) {
    data = JSON.parse(fs.readFileSync(BAUZEIT_PATH, 'utf8'));
  } else {
    data = { start: new Date().toISOString(), levels: {} };
  }
  if (!data || typeof data !== 'object') data = { start: new Date().toISOString(), levels: {} };
  if (!data.start) data.start = new Date().toISOString();
  if (!data.levels || typeof data.levels !== 'object') data.levels = {};
  return data;
}

/**
 * Ergänzt bauzeit.json um neue Einträge. `reached` ist das höchste Level n,
 * bis zu dem in diesem Lauf alle Levels bestanden sind. Bestehende Einträge
 * werden nie verändert. Mit BAUZEIT_FEST=1 wird nur gelesen.
 */
export function updateBauzeit(reached, now) {
  const data = readBauzeit();
  const levels = data.levels;

  let bisher = 0;
  for (let n = 1; n <= 10; n++) {
    if (levels[String(n)]) bisher = n;
    else break;
  }

  if (process.env.BAUZEIT_FEST !== '1' && reached > bisher) {
    const baseIso = bisher > 0 ? levels[String(bisher)].passedAt : data.start;
    const baseMs = Date.parse(baseIso);
    const nowMs = Date.parse(now);
    const buildS = Math.max(0, Math.round((nowMs - baseMs) / 1000));
    for (let n = bisher + 1; n <= reached; n++) {
      if (n === reached) {
        levels[String(n)] = { passedAt: now, buildS };
      } else {
        levels[String(n)] = { passedAt: now, inLevel: reached };
      }
    }
    fs.writeFileSync(BAUZEIT_PATH, JSON.stringify(data, null, 2) + '\n');
  }

  return levels;
}
