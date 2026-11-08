import { arrayItemCount, toInput, type PropertyConfig } from '@sprintster/engine';
import { Button, Select, TextField } from '../ui/index.js';
import styles from './RepeatingGroup.module.css';

export interface RepeatingGroupProps {
  label: string;
  path: string;
  itemProperties: PropertyConfig[];
  inputs: Record<string, string>;
  setInputs: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  layout?: 'stack' | 'table';
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

function SubField({ sub, label, value, onChange }: { sub: PropertyConfig; label: string; value: string; onChange: (v: string) => void }) {
  if (sub.type === 'enum') {
    return <Select label={label} value={value} onChange={onChange} options={sub.values.map((v) => ({ value: v, label: v }))} placeholder="" />;
  }
  if (sub.type === 'integer') return <TextField label={label} value={value} onChange={onChange} inputMode="numeric" />;
  return <TextField label={label} value={value} onChange={onChange} />;
}

export function RepeatingGroup({ label, path, itemProperties, inputs, setInputs, layout = 'stack' }: RepeatingGroupProps) {
  const items = itemsFromInputs(path, itemProperties, inputs);

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

  if (layout === 'table') {
    return (
      <div className={styles.group}>
        <div className={styles.legend}>{label}</div>
        {items.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                {itemProperties.map((s) => (
                  <th key={s.name}>{s.title ?? s.name}</th>
                ))}
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  {itemProperties.map((s) => (
                    <td key={s.name}>
                      <SubField sub={s} label={`${s.title ?? s.name} ${i + 1}`} value={item[s.name] ?? ''} onChange={(v) => change(i, s.name, v)} />
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
              <SubField key={s.name} sub={s} label={s.title ?? s.name} value={item[s.name] ?? ''} onChange={(v) => change(i, s.name, v)} />
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
