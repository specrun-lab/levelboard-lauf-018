export type NoticeKind = 'missing' | 'invalid' | 'unavailable';

interface Props {
  kind: NoticeKind;
}

const TEXTS: Record<NoticeKind, string> = {
  missing: 'Keine Ergebnisse gefunden. Die Datei results.json fehlt.',
  invalid: 'Die Ergebnisdatei ist ungültig. Es werden keine Ergebnisse angezeigt.',
  unavailable: 'Backend nicht erreichbar. Neuer Versuch alle 5 Sekunden.',
};

export default function Notice({ kind }: Props) {
  return (
    <div className="notice" role="alert" data-testid="notice" data-kind={kind}>
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>{TEXTS[kind]}</span>
    </div>
  );
}
