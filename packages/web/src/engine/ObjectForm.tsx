import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  viewFields,
  formatCell,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewFieldSpec,
  type ViewMode,
} from '@sprintster/engine';
import { parseRefIds, type SelectOption } from '../ui/index.js';
import { Field } from './Field.js';
import { RepeatingGroup } from './RepeatingGroup.js';
import { initInputs, readPath, formatError, firstLabelField, type Row } from './resolve.js';
import styles from './ObjectPanel.module.css';

export interface RefData {
  options: SelectOption[];
  rawById: Map<string, Row>;
}

export interface ObjectFormState {
  viewName: string;
  specs: ViewFieldSpec[];
  inputs: Record<string, string>;
  setInputs: Dispatch<SetStateAction<Record<string, string>>>;
  setField: (path: string, value: string) => void;
  refData: Record<string, RefData>;
  displayFor: (spec: ViewFieldSpec) => string;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

export function useObjectForm(
  api: ApiClient,
  obj: ObjectConfig,
  resolveObject: ObjectResolver,
  mode: ViewMode,
  row: Row | null,
): ObjectFormState {
  const viewName = obj.views?.[0]?.name ?? 'default';
  const specs = useMemo(() => viewFields(obj, viewName, mode, resolveObject), [obj, viewName, mode, resolveObject]);
  const [inputs, setInputs] = useState<Record<string, string>>(() => initInputs(specs, mode, row));
  const [refData, setRefData] = useState<Record<string, RefData>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInputs(initInputs(specs, mode, row));
    setError(null);
  }, [specs, mode, row]);

  useEffect(() => {
    let alive = true;
    async function load() {
      const next: Record<string, RefData> = {};
      for (const s of specs) {
        if ((s.property.type !== 'ref' && s.property.type !== 'refs') || s.derivedFromRef !== null) continue;
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
    if (spec.property.type === 'refs') {
      const rd = refData[spec.path];
      return parseRefIds(inputs[spec.path] ?? '', true)
        .map((id) => rd?.options.find((o) => o.value === id)?.label ?? id)
        .join(', ');
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

  return { viewName, specs, inputs, setInputs, setField, refData, displayFor, error, setError, busy, setBusy };
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

export function ObjectFields({ form }: { form: ObjectFormState }) {
  const { specs, inputs, setInputs, setField, refData, displayFor } = form;
  return (
    <>
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
    </>
  );
}
