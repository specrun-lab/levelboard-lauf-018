import type { ReactNode } from 'react';
import {
  formatBuildTime,
  formatCost,
  formatDateTime,
  formatInt,
  formatOneDecimal,
  getBuild,
  LEVEL_TITLES,
  reachedLevel,
  STATUS_LABEL,
  type Level,
  type Run,
  type Usage,
  type UsageLevelIn,
  type UsageNumbers,
} from '../results';

interface Props {
  levels: Level[];
  run: Run | null;
  usage: Usage | null;
}

interface PipelineMetric {
  runId: number;
  url: string;
  jobs: Record<string, number>;
  totalS: number;
}

interface ImagesMetric {
  frontendMB: number;
  backendMB: number;
}

interface LoadtestMetric {
  connections: number;
  durationS: number;
  requests: number;
  errors: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export default function Report({ levels, run, usage }: Props) {
  const empty = !levels.some((l) => l.checkedAt !== null);
  const complete = levels.length === 10 && levels[9].status === 'bestanden';
  const reached = reachedLevel(levels);
  const updatedAt = run?.updatedAt ?? null;
  const commit = run?.commit ?? null;

  const byLevel = (n: number): Level | undefined => levels.find((l) => l.level === n);

  const pipeline = (byLevel(6)?.metrics.pipeline ?? null) as PipelineMetric | null;
  const images = (byLevel(7)?.metrics.images ?? null) as ImagesMetric | null;
  const loadtest = (byLevel(9)?.metrics.loadtest ?? null) as LoadtestMetric | null;

  const totalBuildS = levels.reduce((sum, l) => {
    const b = getBuild(l);
    if (b && typeof b.buildS === 'number') return sum + b.buildS;
    return sum;
  }, 0);

  const hasBuild = levels.some((l) => getBuild(l) !== null);

  function usageEntry(n: number): (UsageNumbers | UsageLevelIn) | null {
    if (!usage || !usage.levels) return null;
    const e = usage.levels[String(n)];
    if (!e) return null;
    return e;
  }

  function levelCost(n: number): string {
    const e = usageEntry(n);
    if (!e) return '–';
    if ('inLevel' in e) return `in L${String(e.inLevel).padStart(2, '0')}`;
    return formatCost(e.costUsd);
  }

  function levelOutput(n: number): string {
    const e = usageEntry(n);
    if (!e) return '–';
    if ('inLevel' in e) return `in L${String(e.inLevel).padStart(2, '0')}`;
    return formatInt(e.output);
  }

  const hasUsage = usage !== null && isRecord(usage.total);

  const renderTilePairs = (pairs: Array<[string, ReactNode, string?]>) => (
    <dl>
      {pairs.map(([dt, dd, testid]) => (
        <div className="rp" key={dt}>
          <dt>{dt}</dt>
          <dd data-testid={testid}>{dd}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section
      className="report"
      aria-label="Abschlussbericht"
      data-testid="report"
      data-state={empty ? 'empty' : 'ready'}
      data-complete={complete ? 'true' : 'false'}
    >
      <h2>Abschlussbericht</h2>
      {empty ? (
        <p className="report-empty" data-testid="report-empty">
          Noch kein Abschlussbericht – er erscheint, sobald das erste Level geprüft ist.
        </p>
      ) : (
        <>
          <div className="report-tiles">
            <div className="report-tile">
              <h3>Ergebnis</h3>
              {renderTilePairs([
                ['Erreicht', `${reached} / 10`, 'report-reached'],
                ['Score', `${reached * 10} / 100`, 'report-score'],
                ['Vollständig', complete ? 'ja' : 'nein', 'report-complete'],
                ['Bauzeit gesamt', hasBuild ? formatBuildTime({ buildS: totalBuildS }) : '–', 'report-build-time'],
                ['Commit', commit ? commit.slice(0, 7) : '–', 'report-commit'],
                ['Stand', formatDateTime(updatedAt), 'report-time'],
              ])}
            </div>

            <div className="report-tile">
              <h3>Tokens</h3>
              {!hasUsage ? (
                <p className="report-missing" data-testid="report-tokens-missing">
                  wird nach der Prüfung ergänzt
                </p>
              ) : (
                renderTilePairs([
                  ['Harness', usage?.harness ?? '–', 'report-harness'],
                  ['Modell', (usage?.models ?? []).join(', ') || '–', 'report-model'],
                  ['Tokens (Ausgabe)', formatInt(usage?.total?.output ?? null), 'report-tokens-output'],
                  ['Tokens gesamt', formatInt(usage?.total?.total ?? null), 'report-tokens-total'],
                  ['Kosten gesamt', formatCost(usage?.total?.costUsd), 'report-cost'],
                ])
              )}
            </div>

            <div className="report-tile">
              <h3>Lasttest</h3>
              {!loadtest ? (
                <p className="report-missing" data-testid="report-loadtest-missing">
                  noch nicht erreicht
                </p>
              ) : (
                renderTilePairs([
                  ['p50', `${loadtest.p50Ms} ms`, 'report-p50'],
                  ['p95', `${loadtest.p95Ms} ms`, 'report-p95'],
                  ['Durchsatz', `${formatOneDecimal(loadtest.rps)} Anfragen/s`, 'report-rps'],
                  ['Fehler', `${loadtest.errors}`, 'report-errors'],
                ])
              )}
            </div>

            <div className="report-tile">
              <h3>Images</h3>
              {!images ? (
                <p className="report-missing" data-testid="report-images-missing">
                  noch nicht erreicht
                </p>
              ) : (
                renderTilePairs([
                  ['Frontend', `${formatOneDecimal(images.frontendMB)} MB`, 'report-image-frontend'],
                  ['Backend', `${formatOneDecimal(images.backendMB)} MB`, 'report-image-backend'],
                ])
              )}
            </div>

            <div className="report-tile">
              <h3>Pipeline</h3>
              {!pipeline ? (
                <p className="report-missing" data-testid="report-pipeline-missing">
                  noch nicht erreicht
                </p>
              ) : (
                <>
                  {renderTilePairs([
                    ['check', pipeline.jobs.check != null ? `${pipeline.jobs.check} s` : '–', 'report-job-check'],
                    ['images', pipeline.jobs.images != null ? `${pipeline.jobs.images} s` : '–', 'report-job-images'],
                    ['deploy', pipeline.jobs.deploy != null ? `${pipeline.jobs.deploy} s` : '–', 'report-job-deploy'],
                    ['Gesamt', `${pipeline.totalS} s`, 'report-pipeline-total'],
                  ])}
                  <a
                    className="report-pipeline-link"
                    data-testid="report-pipeline-link"
                    href={pipeline.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Lauf ansehen
                  </a>
                </>
              )}
            </div>
          </div>

          <div className="report-list-head" aria-hidden="true">
            <span>Level</span>
            <span>Status</span>
            <span className="rlh-cost">Kosten</span>
            <span className="rlh-output">Tokens (Ausgabe)</span>
            <span className="rlh-checked">Geprüft</span>
          </div>
          <ol className="report-levels" data-testid="report-levels">
            {levels.map((l) => (
              <li
                key={l.level}
                className="report-level"
                data-testid="report-level"
                data-level={l.level}
                data-status={l.status}
              >
                <span className="rl-name">
                  L{String(l.level).padStart(2, '0')} {LEVEL_TITLES[l.level - 1]}
                </span>
                <span className={`rl-status status-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                <span className="rl-cost" data-testid="report-level-cost">
                  {levelCost(l.level)}
                </span>
                <span className="rl-output" data-testid="report-level-output">
                  {levelOutput(l.level)}
                </span>
                <span className="rl-checked">{formatDateTime(l.checkedAt)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
