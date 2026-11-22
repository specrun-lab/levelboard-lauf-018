import { formatDateTime, reachedLevel, STATUS_LABEL, type Level, type Run } from '../results';

interface Props {
  levels: Level[];
  run: Run | null;
}

export default function Summary({ levels, run }: Props) {
  const reached = reachedLevel(levels);
  const updatedAt = run?.updatedAt ?? null;

  return (
    <section className="summary" aria-label="Zusammenfassung">
      <div className="summary-left">
        <div className="summary-label">Erreichtes Level</div>
        <div className="summary-value" data-testid="summary-reached">
          {reached} <span className="summary-total">/ 10</span>
        </div>
      </div>
      <div className="summary-right">
        <div
          className="progress"
          role="img"
          aria-label={`${reached} von 10 Levels erreicht`}
          data-testid="summary-progress"
        >
          {levels.map((l) => (
            <span
              key={l.level}
              className={`progress-segment status-${l.status}`}
              title={`Level ${l.level}: ${STATUS_LABEL[l.status]}`}
            />
          ))}
        </div>
        <div className="summary-updated-line">
          Zuletzt aktualisiert:{' '}
          <span className="summary-updated" data-testid="summary-updated">
            {formatDateTime(updatedAt)}
          </span>
        </div>
      </div>
    </section>
  );
}
