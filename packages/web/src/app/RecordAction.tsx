import { useState } from 'react';
import type { GuiAction } from '@sprintster/engine';
import { Button, Modal, TextField } from '../ui/index.js';
import { authFetch } from '../api/auth.js';
import type { RecordRef } from './Extensions.js';
import styles from './Extensions.module.css';

export interface RecordActionProps {
  baseUrl: string;
  action: GuiAction;
  record: RecordRef;
  disabled?: boolean;
  variant?: 'primary' | 'neutral';
  onDone: (reply: { text: string; failed: boolean }) => void;
}

// A datetime-local value is the user's wall-clock time; the server gets the instant.
const toInstant = (local: string) => new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ADR 22 and 25: posts { object, id } (and `value` when the action asks for one) and reports the reply's message.
export function RecordAction({ baseUrl, action, record, disabled = false, variant = 'neutral', onDone }: RecordActionProps) {
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await authFetch(`${baseUrl}${action.route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const reply = (await res.json().catch(() => ({}))) as { message?: string };
      onDone({ text: reply.message ?? (res.ok ? 'Done.' : `Failed (${res.status}).`), failed: !res.ok });
    } catch {
      onDone({ text: 'Cannot reach the server.', failed: true });
    } finally {
      setBusy(false);
      setAsking(false);
      setValue('');
    }
  }

  function start() {
    if (action.input !== undefined) return setAsking(true);
    if (action.confirm !== undefined && !window.confirm(action.confirm)) return;
    void post({ ...record });
  }

  const input = action.input;
  const canSubmit = input !== undefined && (input.optional === true || value !== '');
  return (
    <>
      <Button variant={variant} disabled={disabled || busy} onClick={start}>
        {action.label}
      </Button>
      {asking && input !== undefined && (
        <Modal
          title={action.label}
          width="small"
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="neutral" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!canSubmit || busy} onClick={() => void post({ ...record, value: value === '' ? null : toInstant(value) })}>
                {action.label}
              </Button>
            </>
          }
        >
          {action.confirm !== undefined && <p className={styles.reply}>{action.confirm}</p>}
          <TextField label={input.label} type="datetime-local" value={value} onChange={setValue} />
        </Modal>
      )}
    </>
  );
}
