import { useCallback, useEffect, useState } from 'react';
import type { BadgeTone, GuiAction, GuiBadge, GuiExtensions } from '@sprintster/engine';
import { Button, Pill, type PillTone } from '../ui/index.js';
import { authFetch } from '../api/auth.js';
import styles from './Extensions.module.css';

const TONES: Record<BadgeTone, PillTone> = { neutral: 'neutral', info: 'info', success: 'success', warning: 'warning', danger: 'danger' };

function Badge({ baseUrl, badge, tick }: { baseUrl: string; badge: GuiBadge; tick: number }) {
  const [state, setState] = useState<{ text: string; tone: BadgeTone } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      authFetch(`${baseUrl}${badge.route}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ text: string; tone?: BadgeTone }>) : null))
        .then((body) => alive && setState(body === null ? null : { text: body.text, tone: body.tone ?? 'neutral' }))
        .catch(() => alive && setState(null));
    void load();
    const timer = badge.refresh === undefined ? undefined : setInterval(() => void load(), badge.refresh * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [baseUrl, badge, tick]);
  return state === null ? null : <Pill tone={TONES[state.tone] ?? 'neutral'}>{state.text}</Pill>;
}

// Declared by daemon plugins: each action POSTs to its route and shows the reply, and every badge reloads after it.
export function Extensions({ baseUrl, extensions }: { baseUrl: string; extensions: GuiExtensions }) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; failed: boolean } | null>(null);

  const run = useCallback(
    async (action: GuiAction) => {
      if (action.confirm !== undefined && !window.confirm(action.confirm)) return;
      setBusy(action.id);
      setReply(null);
      try {
        const res = await authFetch(`${baseUrl}${action.route}`, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setReply({ text: body.message ?? (res.ok ? 'Done.' : `Failed (${res.status}).`), failed: !res.ok });
      } catch {
        setReply({ text: 'Cannot reach the server.', failed: true });
      } finally {
        setBusy(null);
        setTick((t) => t + 1);
      }
    },
    [baseUrl],
  );

  if (extensions.actions.length === 0 && extensions.badges.length === 0) return null;
  return (
    <div className={styles.extensions}>
      {extensions.badges.map((b) => (
        <Badge key={b.id} baseUrl={baseUrl} badge={b} tick={tick} />
      ))}
      {extensions.actions.map((a) => (
        <Button key={a.id} variant="primary" disabled={busy !== null} onClick={() => void run(a)}>
          {a.label}
        </Button>
      ))}
      {reply !== null && <div className={reply.failed ? styles.failed : styles.reply}>{reply.text}</div>}
    </div>
  );
}
