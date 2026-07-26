import { useMemo, useState } from 'react';
import {
  assembleValues,
  lifecycleInfo,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewMode,
} from '@sprintster/engine';
import { Modal, Button, ConfirmDialog, type ButtonVariant } from '../ui/index.js';
import { ObjectFields, useObjectForm } from './ObjectForm.js';
import { formatError, primaryLabel, type Row } from './resolve.js';
import styles from './ObjectPanel.module.css';

type Confirm = { kind: 'delete' } | { kind: 'command'; command: string; to: string };

export interface ObjectPanelProps {
  api: ApiClient;
  obj: ObjectConfig;
  resolveObject: ObjectResolver;
  initialMode: ViewMode;
  row: Row | null;
  onClose: () => void;
  onChanged: () => void;
}

function commandTone(to: string): ButtonVariant {
  return to === 'cancelled' ? 'destructive' : 'additive';
}

export function ObjectPanel({ api, obj, resolveObject, initialMode, row, onClose, onChanged }: ObjectPanelProps) {
  const [mode] = useState<ViewMode>(initialMode);
  const form = useObjectForm(api, obj, resolveObject, mode, row);
  const { viewName, inputs, error, setError, busy, setBusy } = form;
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const lifecycle = useMemo(() => lifecycleInfo(obj), [obj]);
  const actions = obj.lists[0]?.actions ?? [];
  const canDelete = actions.some((a) => a.kind === 'delete');
  const statusField = lifecycle.kind === 'statusField' ? lifecycle.field : null;
  const status = row !== null && statusField !== null ? String(row[statusField] ?? '') : '';
  const availableCommands = (obj.commands ?? []).filter((c) => c.transition.from.includes(status));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  function save() {
    void run(async () => {
      const assembled = assembleValues(obj, viewName, inputs, mode);
      if (mode === 'create') await api.object(obj.name).add({ id: globalThis.crypto.randomUUID(), ...assembled });
      else await api.object(obj.name).update(String(row!['id']), assembled);
    });
  }

  function doDelete() {
    void run(() => api.object(obj.name).remove(String(row!['id'])));
  }

  function doCommand(name: string) {
    void run(() => api.object(obj.name).transition(String(row!['id']), name));
  }

  const title = mode === 'create' ? `New ${obj.title}` : `Edit ${obj.title}`;

  const footer = (
    <>
      {mode === 'edit' && canDelete && (
        <Button variant="destructive" onClick={() => setConfirm({ kind: 'delete' })}>
          Delete
        </Button>
      )}
      {mode === 'edit' &&
        availableCommands.map((c) => (
          <Button
            key={c.name}
            variant={commandTone(c.transition.to)}
            onClick={() =>
              commandTone(c.transition.to) === 'destructive'
                ? setConfirm({ kind: 'command', command: c.name, to: c.transition.to })
                : doCommand(c.name)
            }
          >
            {c.name}
          </Button>
        ))}
      <div className={styles.spacer} />
      <Button variant="neutral" onClick={onClose}>
        Close
      </Button>
      <Button variant="primary" disabled={busy} onClick={save}>
        Save
      </Button>
    </>
  );

  return (
    <>
      <Modal title={title} onClose={onClose} footer={footer}>
        {error !== null && <div className={styles.error}>{error}</div>}
        <ObjectFields form={form} />
      </Modal>

      {confirm !== null && row !== null && (
        <ConfirmDialog
          title={confirm.kind === 'delete' ? `Delete ${obj.title.toLowerCase()}` : `${confirm.command} ${obj.title.toLowerCase()}`}
          message={
            confirm.kind === 'delete'
              ? 'This cannot be undone. Type the name to confirm.'
              : 'Type the name to confirm this change.'
          }
          expected={primaryLabel(obj, row)}
          confirmLabel={confirm.kind === 'delete' ? 'Delete' : confirm.command}
          onConfirm={() => {
            if (confirm.kind === 'delete') doDelete();
            else doCommand(confirm.command);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
