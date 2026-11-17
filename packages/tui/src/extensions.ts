import { useCallback, useEffect, useState } from 'react';
import { liveUrl, watchLog, type GuiAction, type GuiExtensions, type LiveOptions } from '@sprintster/engine';

export interface Extensions {
  actions: GuiAction[];
  badges: string;
  // A record action (ADR 22) is posted the record it acts on.
  run(action: GuiAction, record?: { object: string; id: string }): Promise<string>;
}

// Plugin actions and badges as the daemon lists them in /config; the TUI shows badge text in its footer and runs actions on Ctrl+hotkey.
// `connect` opens the live socket (ADR 28); null leaves it closed.
export function useExtensions(daemonUrl: string, fetchImpl: typeof fetch = fetch, connect?: LiveOptions['connect'] | null): Extensions {
  const [declared, setDeclared] = useState<GuiExtensions>({ actions: [], badges: [] });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetchImpl(`${daemonUrl}/config`)
      .then((r) => r.json() as Promise<{ extensions?: GuiExtensions }>)
      .then((body) => setDeclared(body.extensions ?? { actions: [], badges: [] }))
      .catch(() => {});
  }, [daemonUrl, fetchImpl]);

  useEffect(() => {
    let alive = true;
    // A record badge needs a record, so the footer only shows the app-wide ones.
    for (const badge of declared.badges.filter((b) => b.placement !== 'record')) {
      fetchImpl(`${daemonUrl}${badge.route}`)
        .then((r) => r.json() as Promise<{ text?: string }>)
        .then((body) => alive && setTexts((t) => ({ ...t, [badge.id]: body.text ?? '' })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [daemonUrl, fetchImpl, declared, tick]);

  useEffect(() => {
    if (connect === null) return;
    const watch = watchLog(liveUrl(daemonUrl, daemonUrl), { onChange: () => setTick((t) => t + 1), ...(connect === undefined ? {} : { connect }) });
    return () => watch.close();
  }, [daemonUrl, connect]);

  const run = useCallback(
    async (action: GuiAction, record?: { object: string; id: string }) => {
      try {
        const res = await fetchImpl(
          `${daemonUrl}${action.route}`,
          record === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) },
        );
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return body.message ?? (res.ok ? `${action.label}: done.` : `${action.label} failed (${res.status}).`);
      } catch {
        return `Cannot reach daemon at ${daemonUrl}.`;
      } finally {
        setTick((t) => t + 1);
      }
    },
    [daemonUrl, fetchImpl],
  );

  const badges = declared.badges.map((b) => texts[b.id]).filter((t): t is string => t !== undefined && t !== '').join(' · ');
  return { actions: declared.actions, badges, run };
}
