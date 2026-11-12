import { useCallback, useEffect, useState } from 'react';
import type { BadgeTone, GuiAction, GuiBadge, GuiExtensions } from '@sprintster/engine';
import { Button, Pill, type PillTone } from '../ui/index.js';
import { authFetch } from '../api/auth.js';
import { RecordAction } from './RecordAction.js';
import styles from './Extensions.module.css';

const TONES: Record<BadgeTone, PillTone> = { neutral: 'neutral', info: 'info', success: 'success', warning: 'warning', danger: 'danger' };

export interface RecordRef {
  object: string;
  id: string;
}

const recordQuery = (record: RecordRef | undefined) =>
  record === undefined ? '' : `?object=${encodeURIComponent(record.object)}&id=${encodeURIComponent(record.id)}`;

function Badge({ baseUrl, badge, tick, record }: { baseUrl: string; badge: GuiBadge; tick: number; record?: RecordRef | undefined }) {
  const [state, setState] = useState<{ text: string; tone: BadgeTone } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      authFetch(`${baseUrl}${badge.route}${recordQuery(record)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ text: string; tone?: BadgeTone }>) : null))
        .then((body) => alive && setState(body === null ? null : { text: body.text, tone: body.tone ?? 'neutral' }))
        .catch(() => alive && setState(null));
    void load();
    const timer = badge.refresh === undefined ? undefined : setInterval(() => void load(), badge.refresh * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [baseUrl, badge, tick, record?.object, record?.id]);
  return state === null ? null : <Pill tone={TONES[state.tone] ?? 'neutral'}>{state.text}</Pill>;
}

// Declared by daemon plugins: each action POSTs to its route and shows the reply, and every badge reloads after it.
// With `record`, they act on that record (ADR 22).
export function Extensions({
  baseUrl,
  extensions,
  record,
  inline,
  disabled,
  onActed,
}: {
  baseUrl: string;
  extensions: GuiExtensions;
  record?: RecordRef;
  inline?: boolean;
  disabled?: (action: GuiAction) => boolean;
  onActed?: (reply: { text: string; failed: boolean }) => void;
}) {
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; failed: boolean } | null>(null);

  const run = useCallback(
    async (action: GuiAction) => {
      if (action.confirm !== undefined && !window.confirm(action.confirm)) return;
      setBusy(action.id);
      setReply(null);
      try {
        const res = await authFetch(
          `${baseUrl}${action.route}`,
          record === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(record) },
        );
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setReply({ text: body.message ?? (res.ok ? 'Done.' : `Failed (${res.status}).`), failed: !res.ok });
      } catch {
        setReply({ text: 'Cannot reach the server.', failed: true });
      } finally {
        setBusy(null);
        setTick((t) => t + 1);
      }
    },
    [baseUrl, record?.object, record?.id],
  );

  if (extensions.actions.length === 0 && extensions.badges.length === 0) return null;
  return (
    <div className={inline === true ? styles.inline : styles.extensions}>
      {extensions.badges.map((b) => (
        <Badge key={b.id} baseUrl={baseUrl} badge={b} tick={tick} record={record} />
      ))}
      {extensions.actions.map((a) =>
        record !== undefined ? (
          <RecordAction
            key={a.id}
            baseUrl={baseUrl}
            action={a}
            record={record}
            disabled={disabled?.(a) ?? false}
            onDone={(r) => {
              if (onActed !== undefined) return onActed(r);
              setReply(r);
              setTick((t) => t + 1);
            }}
          />
        ) : (
          <Button key={a.id} variant={inline === true ? 'neutral' : 'primary'} disabled={busy !== null} onClick={() => void run(a)}>
            {a.label}
          </Button>
        ),
      )}
      {reply !== null && <div className={reply.failed ? styles.failed : styles.reply}>{reply.text}</div>}
    </div>
  );
}
