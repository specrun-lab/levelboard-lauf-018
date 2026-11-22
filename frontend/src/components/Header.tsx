import type { Run } from '../results';

export type Source = 'file' | 'api' | '';

interface Props {
  run: Run | null;
  source: Source;
}

export default function Header({ run, source }: Props) {
  const id = run?.id ?? '–';
  const version = run?.version ?? '–';
  const commit = run?.commit ?? null;
  const commitShort = commit ? commit.slice(0, 7) : '–';
  const sourceText = source === 'api' ? 'Backend' : source === 'file' ? 'Datei' : '–';

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ▮▮▮
        </span>
        <span className="brand-name">Levelboard</span>
      </div>
      <dl className="meta">
        <div className="meta-pair">
          <dt>Durchlauf</dt>
          <dd data-testid="run-id">{id}</dd>
        </div>
        <div className="meta-pair">
          <dt>Version</dt>
          <dd data-testid="run-version">{version}</dd>
        </div>
        <div className="meta-pair meta-pair-commit">
          <dt>Commit</dt>
          <dd data-testid="run-commit" title={commit ?? undefined}>
            {commitShort}
          </dd>
        </div>
        <div className="meta-pair meta-pair-source">
          <dt>Quelle</dt>
          <dd data-testid="run-source" data-source={source}>
            {sourceText}
          </dd>
        </div>
      </dl>
    </header>
  );
}
