import { useEffect, useState } from 'react';
import Header, { type Source } from './components/Header';
import LevelCard from './components/LevelCard';
import Notice, { type NoticeKind } from './components/Notice';
import Report from './components/Report';
import Summary from './components/Summary';
import {
  emptyLevels,
  isValidUsage,
  validateResults,
  type Results,
  type Usage,
} from './results';

type LoadState = 'loading' | 'ok' | 'missing' | 'invalid' | 'unavailable';

export default function App() {
  const [source, setSource] = useState<Source>('');
  const [state, setState] = useState<LoadState>('loading');
  const [results, setResults] = useState<Results | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const loadConfig = async (): Promise<'file' | 'api'> => {
      try {
        const res = await fetch('/config.json', { cache: 'no-store' });
        if (res.ok) {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          if (!ct.includes('text/html')) {
            const data: unknown = await res.json();
            if (
              data &&
              typeof data === 'object' &&
              !Array.isArray(data) &&
              (data as { source?: unknown }).source === 'api'
            ) {
              return 'api';
            }
          }
        }
      } catch {
        // fall through to file mode
      }
      return 'file';
    };

    const loadFile = async () => {
      setState('loading');
      let res: Response;
      try {
        res = await fetch('/results.json', { cache: 'no-store' });
      } catch {
        setState('missing');
        return;
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.status === 404) {
        setState('missing');
        return;
      }
      if (res.ok && ct.includes('text/html')) {
        setState('missing');
        return;
      }
      if (!res.ok) {
        setState('invalid');
        return;
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        setState('invalid');
        return;
      }
      if (validateResults(data)) {
        setResults(data);
        setState('ok');
      } else {
        setState('invalid');
      }
    };

    const loadApiLevels = async (first: boolean) => {
      if (first) setState('loading');
      let res: Response;
      try {
        res = await fetch('/api/levels', { cache: 'no-store' });
      } catch {
        setState('unavailable');
        return;
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || ct.includes('text/html')) {
        setState('unavailable');
        return;
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        setState('invalid');
        return;
      }
      if (validateResults(data)) {
        setResults(data);
        setState('ok');
      } else {
        setState('invalid');
      }
    };

    const loadUsage = async () => {
      try {
        const res = await fetch('/api/usage', { cache: 'no-store' });
        if (!res.ok) {
          setUsage(null);
          return;
        }
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          setUsage(null);
          return;
        }
        const data: unknown = await res.json();
        setUsage(isValidUsage(data) ? data : null);
      } catch {
        setUsage(null);
      }
    };

    const pollApi = async () => {
      await loadApiLevels(false);
      await loadUsage();
      if (!cancelled) {
        timer = setTimeout(pollApi, 5000);
      }
    };

    (async () => {
      const src = await loadConfig();
      if (cancelled) return;
      setSource(src);
      if (src === 'api') {
        await loadApiLevels(true);
        await loadUsage();
        if (!cancelled) {
          timer = setTimeout(pollApi, 5000);
        }
      } else {
        await loadFile();
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const showNotice = state === 'missing' || state === 'invalid' || state === 'unavailable';
  const levels = state === 'ok' && results ? results.levels : emptyLevels();
  const run = state === 'ok' && results ? results.run : null;

  return (
    <div className="app" data-testid="board" data-state={state}>
      <Header run={run} source={source} />
      <main className="main">
        {showNotice && <Notice kind={state as NoticeKind} />}
        <Summary levels={levels} run={run} />
        <section className="grid" aria-label="Levels">
          {levels.map((l) => (
            <LevelCard key={l.level} level={l} />
          ))}
        </section>
        <Report levels={levels} run={run} usage={usage} />
      </main>
    </div>
  );
}
