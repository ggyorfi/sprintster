import { arrayItemCount, conditionHolds, toInput, type PropertyConfig, type VisibleWhen } from '@sprintster/engine';
import { Button, Select, TextField } from '../ui/index.js';
import styles from './RepeatingGroup.module.css';

export interface RepeatingGroupProps {
  label: string;
  path: string;
  itemProperties: PropertyConfig[];
  inputs: Record<string, string>;
  setInputs: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  layout?: 'stack' | 'table';
  columnChoices?: Record<string, string[]> | undefined;
  // A column with an entry here is titled by it, and hidden while it is empty.
  columnLabels?: Record<string, string> | undefined;
  columnVisibleWhen?: Record<string, VisibleWhen> | undefined;
  readOnly?: boolean | undefined;
}

type Item = Record<string, string>;

function itemsFromInputs(path: string, subs: PropertyConfig[], inputs: Record<string, string>): Item[] {
  const count = arrayItemCount(path, inputs);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const item: Item = {};
    for (const s of subs) item[s.name] = inputs[`${path}.${i}.${s.name}`] ?? '';
    items.push(item);
  }
  return items;
}

function SubField({ sub, label, value, onChange, choices }: { sub: PropertyConfig; label: string; value: string; onChange: (v: string) => void; choices?: string[] | undefined }) {
  if (choices !== undefined && choices.length > 0) {
    // A saved value no longer on the list stays visible instead of silently changing.
    const all = value === '' || choices.includes(value) ? choices : [value, ...choices];
    return <Select label={label} value={value} onChange={onChange} options={all.map((v) => ({ value: v, label: v }))} placeholder="" />;
  }
  if (sub.type === 'enum') {
    return <Select label={label} value={value} onChange={onChange} options={sub.values.map((v) => ({ value: v, label: v }))} placeholder="" />;
  }
  if (sub.type === 'money') return <TextField label={label} value={value} onChange={onChange} prefix="£" inputMode="decimal" />;
  if (sub.type === 'integer') return <TextField label={label} value={value} onChange={onChange} inputMode="numeric" />;
  return <TextField label={label} value={value} onChange={onChange} />;
}

export function RepeatingGroup({ label, path, itemProperties, inputs, setInputs, layout = 'stack', columnChoices, columnLabels, columnVisibleWhen, readOnly = false }: RepeatingGroupProps) {
  const items = itemsFromInputs(path, itemProperties, inputs);
  const titleOf = (s: PropertyConfig) => columnLabels?.[s.name] || s.title || s.name;
  // Hidden columns keep their values, so switching a condition back loses nothing.
  const shown = itemProperties.filter((s) => columnLabels?.[s.name] !== '' && (columnVisibleWhen?.[s.name] === undefined || conditionHolds(columnVisibleWhen[s.name]!, inputs)));

  function commit(next: Item[]) {
    setInputs((prev) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (!k.startsWith(`${path}.`)) out[k] = v;
      next.forEach((item, i) => {
        for (const s of itemProperties) out[`${path}.${i}.${s.name}`] = item[s.name] ?? '';
      });
      return out;
    });
  }

  const blank = (): Item => Object.fromEntries(itemProperties.map((s) => [s.name, s.default !== undefined ? toInput(s, s.default) : '']));
  const change = (i: number, name: string, v: string) => commit(items.map((it, idx) => (idx === i ? { ...it, [name]: v } : it)));
  const remove = (i: number) => commit(items.filter((_, idx) => idx !== i));

  if (readOnly) {
    // A raw reference id means nothing to a reader; such columns are left out.
    const readable = shown.filter((s) => s.type !== 'ref' && s.type !== 'refs');
    return (
      <div className={styles.group}>
        <div className={styles.legend}>{label}</div>
        {items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                {readable.map((s) => (
                  <th key={s.name}>{titleOf(s)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  {readable.map((s) => (
                    <td key={s.name}>{item[s.name] === '' || item[s.name] === undefined ? '\u2013' : item[s.name]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  if (layout === 'table') {
    return (
      <div className={styles.group}>
        <div className={styles.legend}>{label}</div>
        {items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                {shown.map((s) => (
                  <th key={s.name}>{titleOf(s)}</th>
                ))}
                <th className={styles.removeCell} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  {shown.map((s) => (
                    <td key={s.name}>
                      <SubField sub={s} label={`${titleOf(s)} ${i + 1}`} value={item[s.name] ?? ''} onChange={(v) => change(i, s.name, v)} choices={columnChoices?.[s.name]} />
                    </td>
                  ))}
                  <td className={styles.removeCell}>
                    <button type="button" className={styles.removeRow} aria-label={`Remove row ${i + 1}`} onClick={() => remove(i)}>
                      {'×'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div>
          <Button variant="additive" onClick={() => commit([...items, blank()])}>
            Add row
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.group}>
      <div className={styles.legend}>{label}</div>
      {items.map((item, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.itemFields}>
            {itemProperties.map((s) => (
              <SubField key={s.name} sub={s} label={s.title ?? s.name} value={item[s.name] ?? ''} onChange={(v) => change(i, s.name, v)} choices={columnChoices?.[s.name]} />
            ))}
          </div>
          <Button variant="destructive" onClick={() => remove(i)}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button variant="additive" onClick={() => commit([...items, blank()])}>
          Add another
        </Button>
      </div>
    </div>
  );
}
