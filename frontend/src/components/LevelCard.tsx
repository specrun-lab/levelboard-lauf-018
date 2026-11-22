import {
  formatBuildTime,
  formatDateTime,
  formatDuration,
  getBuild,
  LEVEL_TITLES,
  STATUS_LABEL,
  type Level,
} from '../results';

interface Props {
  level: Level;
}

export default function LevelCard({ level }: Props) {
  const checksOk = level.checks.filter((c) => c.ok).length;
  const checksTotal = level.checks.length;

  return (
    <article
      className={`level-card status-${level.status}`}
      data-testid="level-card"
      data-level={level.level}
      data-status={level.status}
    >
      <div className="level-card-head">
        <span className="level-num">L{String(level.level).padStart(2, '0')}</span>
        <span className="badge" data-testid="level-status">
          <span className="badge-dot" aria-hidden="true" />
          {STATUS_LABEL[level.status]}
        </span>
      </div>
      <h2 className="level-title" data-testid="level-title">
        {LEVEL_TITLES[level.level - 1]}
      </h2>
      <dl className="level-facts">
        <div className="fact">
          <dt>Geprüft</dt>
          <dd data-testid="level-checked-at">{formatDateTime(level.checkedAt)}</dd>
        </div>
        <div className="fact">
          <dt>Checkdauer</dt>
          <dd data-testid="level-duration">{formatDuration(level.durationMs)}</dd>
        </div>
        <div className="fact">
          <dt>Checks</dt>
          <dd data-testid="level-checks">
            {checksTotal === 0 ? '–' : `${checksOk}/${checksTotal}`}
          </dd>
        </div>
        <div className="fact">
          <dt>Bauzeit</dt>
          <dd data-testid="level-build-time">{formatBuildTime(getBuild(level))}</dd>
        </div>
      </dl>
    </article>
  );
}
