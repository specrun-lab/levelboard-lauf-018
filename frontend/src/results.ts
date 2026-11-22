export type Status = 'offen' | 'bestanden' | 'fehlgeschlagen' | 'gesperrt';

export interface Check {
  name: string;
  ok: boolean;
}

export interface Level {
  level: number;
  title: string;
  status: Status;
  checkedAt: string | null;
  durationMs: number | null;
  checks: Check[];
  metrics: Record<string, unknown>;
}

export interface Run {
  id: string;
  version: string;
  commit: string | null;
  updatedAt: string | null;
}

export interface Results {
  run: Run;
  levels: Level[];
}

export interface UsageNumbers {
  output: number;
  total: number;
  costUsd: number | null;
}

export interface UsageLevelIn {
  inLevel: number;
}

export interface Usage {
  harness?: string;
  models?: string[];
  measuredAt?: string;
  total?: UsageNumbers;
  levels?: Record<string, UsageNumbers | UsageLevelIn>;
}

export const LEVEL_TITLES = [
  'Statische Seite',
  'Webserver',
  'REST-Backend',
  'Datenbank',
  'Frontend + Backend',
  'Repo + CI',
  'Images in der Pipeline',
  'Deployment',
  'Live-Prüfung',
  'Metriken veröffentlicht',
];

export const STATUS_LABEL: Record<Status, string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

export function emptyLevels(): Level[] {
  return LEVEL_TITLES.map((title, i) => ({
    level: i + 1,
    title,
    status: 'offen' as Status,
    checkedAt: null,
    durationMs: null,
    checks: [],
    metrics: {},
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isValidCheck(check: unknown): boolean {
  if (!isRecord(check)) return false;
  const keys = Object.keys(check);
  if (keys.length !== 2) return false;
  if (typeof check.name !== 'string' || check.name.length < 1) return false;
  if (typeof check.ok !== 'boolean') return false;
  return true;
}

function isValidRun(run: unknown): boolean {
  if (!isRecord(run)) return false;
  const keys = Object.keys(run);
  if (keys.length !== 4) return false;
  if (typeof run.id !== 'string' || run.id.length < 1) return false;
  if (typeof run.version !== 'string' || run.version.length < 1) return false;
  if (run.commit !== null && typeof run.commit !== 'string') return false;
  if (run.updatedAt !== null && (typeof run.updatedAt !== 'string' || !isDate(run.updatedAt))) return false;
  return true;
}

function isValidLevel(level: unknown): boolean {
  if (!isRecord(level)) return false;
  const keys = Object.keys(level);
  const required = ['level', 'title', 'status', 'checkedAt', 'durationMs', 'checks', 'metrics'];
  if (keys.length !== required.length) return false;
  for (const k of required) if (!(k in level)) return false;
  if (typeof level.level !== 'number' || !Number.isInteger(level.level) || level.level < 1 || level.level > 10) return false;
  if (typeof level.title !== 'string') return false;
  if (level.status !== 'offen' && level.status !== 'bestanden' && level.status !== 'fehlgeschlagen' && level.status !== 'gesperrt') return false;
  if (level.checkedAt !== null && (typeof level.checkedAt !== 'string' || !isDate(level.checkedAt))) return false;
  if (level.durationMs !== null && (typeof level.durationMs !== 'number' || !Number.isInteger(level.durationMs) || level.durationMs < 0)) return false;
  if (!Array.isArray(level.checks) || !level.checks.every(isValidCheck)) return false;
  if (!isRecord(level.metrics)) return false;
  return true;
}

export function validateResults(data: unknown): data is Results {
  if (!isRecord(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !('run' in data) || !('levels' in data)) return false;
  if (!isValidRun(data.run)) return false;
  if (!Array.isArray(data.levels) || data.levels.length !== 10) return false;
  const seen = new Set<number>();
  for (const l of data.levels) {
    if (!isValidLevel(l)) return false;
    const num = (l as Level).level;
    if (seen.has(num)) return false;
    seen.add(num);
  }
  for (let i = 1; i <= 10; i++) if (!seen.has(i)) return false;
  return true;
}

export function isValidUsage(data: unknown): data is Usage {
  if (!isRecord(data)) return false;
  const total = data.total;
  if (!isRecord(total)) return false;
  if (typeof total.output !== 'number' || !Number.isInteger(total.output) || total.output < 0) return false;
  if (typeof total.total !== 'number' || !Number.isInteger(total.total) || total.total < 0) return false;
  if (total.costUsd !== null && typeof total.costUsd !== 'number') return false;
  return true;
}

export function reachedLevel(levels: Level[]): number {
  let reached = 0;
  for (const l of levels) {
    if (l.level === reached + 1 && l.status === 'bestanden') reached = l.level;
    else break;
  }
  return reached;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export interface BuildMetric {
  passedAt: string;
  buildS?: number;
  inLevel?: number;
}

export function formatBuildTime(build: unknown): string {
  if (!isRecord(build)) return '–';
  if (typeof build.inLevel === 'number' && Number.isInteger(build.inLevel)) {
    return `in L${pad2(build.inLevel)}`;
  }
  if (typeof build.buildS === 'number') {
    const s = Math.round(build.buildS);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${pad2(sec)} min`;
  }
  return '–';
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return n.toLocaleString('de-CH');
}

export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined) return '–';
  return `${costUsd.toFixed(2).replace('.', ',')} USD`;
}

export function formatOneDecimal(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

export function getBuild(level: Level): BuildMetric | null {
  const b = level.metrics.build;
  if (!isRecord(b)) return null;
  return b as unknown as BuildMetric;
}
