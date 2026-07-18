import { useEffect, useMemo, useState } from 'react';
import {
  viewFields,
  assembleValues,
  lifecycleInfo,
  formatCell,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewFieldSpec,
  type ViewMode,
} from '@sprintster/engine';
import { Modal, Button, ConfirmDialog, type ButtonVariant, type SelectOption } from '../ui/index.js';
import { Field } from './Field.js';
import { RepeatingGroup } from './RepeatingGroup.js';
import {
  initInputs,
  readPath,
  formatError,
  firstLabelField,
  primaryLabel,
  type Row,
} from './resolve.js';
import styles from './ObjectPanel.module.css';

interface RefData {
  options: SelectOption[];
  rawById: Map<string, Row>;
}

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

function sections(specs: ViewFieldSpec[]): Array<{ title: string | null; specs: ViewFieldSpec[] }> {
  const out: Array<{ title: string | null; specs: ViewFieldSpec[] }> = [];
  for (const s of specs) {
    const last = out[out.length - 1];
    if (last !== undefined && last.title === s.group) last.specs.push(s);
    else out.push({ title: s.group, specs: [s] });
  }
  return out;
}

function commandTone(to: string): ButtonVariant {
  return to === 'cancelled' ? 'destructive' : 'additive';
}

export function ObjectPanel({ api, obj, resolveObject, initialMode, row, onClose, onChanged }: ObjectPanelProps) {
  const viewName = obj.views?.[0]?.name ?? 'default';
  const [mode] = useState<ViewMode>(initialMode);
  const specs = useMemo(() => viewFields(obj, viewName, mode, resolveObject), [obj, viewName, mode, resolveObject]);
  const [inputs, setInputs] = useState<Record<string, string>>(() => initInputs(specs, mode, row));
  const [refData, setRefData] = useState<Record<string, RefData>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  useEffect(() => {
    setInputs(initInputs(specs, mode, row));
    setError(null);
  }, [specs, mode, row]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const next: Record<string, RefData> = {};
      for (const s of specs) {
        if (s.property.type !== 'ref' || s.derivedFromRef !== null) continue;
        const list = await api.object<Row>(s.property.target).list();
        const target = resolveObject(s.property.target);
        const labelField = s.property.display ?? (target ? firstLabelField(target) : 'id');
        next[s.path] = {
          options: list.map((r) => ({ value: String(r['id']), label: String(r[labelField] ?? r['id']) })),
          rawById: new Map(list.map((r) => [String(r['id']), r])),
        };
      }
      if (alive) setRefData(next);
    }
    load().catch((e) => {
      if (alive) setError(formatError(e));
    });
    return () => {
      alive = false;
    };
  }, [api, specs, resolveObject]);

  const lifecycle = useMemo(() => lifecycleInfo(obj), [obj]);
  const actions = obj.lists[0]?.actions ?? [];
  const canDelete = actions.some((a) => a.kind === 'delete');
  const status = row !== null && lifecycle.kind === 'statusField' ? String(row[lifecycle.field] ?? '') : '';
  const availableCommands = (obj.commands ?? []).filter((c) => c.transition.from.includes(status));

  function setField(path: string, value: string) {
    setInputs((prev) => ({ ...prev, [path]: value }));
  }

  function displayFor(spec: ViewFieldSpec): string {
    if (spec.derivedFromRef !== null) {
      const rd = refData[spec.derivedFromRef];
      const raw = rd?.rawById.get(inputs[spec.derivedFromRef] ?? '');
      const leaf = spec.path.slice(spec.path.lastIndexOf('.') + 1);
      const v = raw ? raw[leaf] : undefined;
      return v == null ? '' : String(v);
    }
    if (spec.property.type === 'ref') {
      const rd = refData[spec.path];
      return rd?.options.find((o) => o.value === inputs[spec.path])?.label ?? inputs[spec.path] ?? '';
    }
    if (spec.property.type === 'array') {
      const arr = row !== null ? readPath(row, spec.path) : undefined;
      if (!Array.isArray(arr)) return '';
      return arr
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          const first = o['value'] ?? Object.values(o)[0];
          return first == null ? '' : String(first);
        })
        .filter(Boolean)
        .join(', ');
    }
    const raw = row !== null ? readPath(row, spec.path) : undefined;
    return formatCell(spec.property, raw, '');
  }

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
        {sections(specs).map((section, i) => (
          <div key={section.title ?? `s${i}`} className={section.title !== null ? styles.fieldset : undefined}>
            {section.title !== null && <div className={styles.legend}>{section.title}</div>}
            <div className={styles.fields}>
              {section.specs.map((spec) =>
                spec.editable && spec.property.type === 'array' ? (
                  <RepeatingGroup
                    key={spec.path}
                    label={spec.label}
                    path={spec.path}
                    itemProperties={spec.property.item.properties}
                    inputs={inputs}
                    setInputs={setInputs}
                  />
                ) : (
                  <Field
                    key={spec.path}
                    spec={spec}
                    value={inputs[spec.path] ?? ''}
                    onChange={(v) => setField(spec.path, v)}
                    refOptions={refData[spec.path]?.options}
                    display={displayFor(spec)}
                  />
                ),
              )}
            </div>
          </div>
        ))}
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
