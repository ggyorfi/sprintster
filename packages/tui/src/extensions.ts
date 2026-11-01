import { useCallback, useEffect, useState } from 'react';
import type { GuiAction, GuiExtensions } from '@sprintster/engine';

export interface Extensions {
  actions: GuiAction[];
  badges: string;
  run(action: GuiAction): Promise<string>;
}

// Plugin actions and badges as the daemon lists them in /config; the TUI shows badge text in its footer and runs actions on Ctrl+hotkey.
export function useExtensions(daemonUrl: string, fetchImpl: typeof fetch = fetch): Extensions {
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
    const timers = declared.badges.map((badge) => {
      const load = () =>
        fetchImpl(`${daemonUrl}${badge.route}`)
          .then((r) => r.json() as Promise<{ text?: string }>)
          .then((body) => alive && setTexts((t) => ({ ...t, [badge.id]: body.text ?? '' })))
          .catch(() => {});
      void load();
      return badge.refresh === undefined ? undefined : setInterval(() => void load(), badge.refresh * 1000);
    });
    return () => {
      alive = false;
      timers.forEach((t) => clearInterval(t));
    };
  }, [daemonUrl, fetchImpl, declared, tick]);

  const run = useCallback(
    async (action: GuiAction) => {
      try {
        const res = await fetchImpl(`${daemonUrl}${action.route}`, { method: 'POST' });
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
