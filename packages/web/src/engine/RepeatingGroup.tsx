import { arrayItemCount, type PropertyConfig } from '@sprintster/engine';
import { Button, TextField } from '../ui/index.js';
import styles from './RepeatingGroup.module.css';

export interface RepeatingGroupProps {
  label: string;
  path: string;
  itemProperties: PropertyConfig[];
  inputs: Record<string, string>;
  setInputs: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
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

export function RepeatingGroup({ label, path, itemProperties, inputs, setInputs }: RepeatingGroupProps) {
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

  const blank = (): Item => Object.fromEntries(itemProperties.map((s) => [s.name, '']));

  return (
    <div className={styles.group}>
      <div className={styles.legend}>{label}</div>
      {items.map((item, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.itemFields}>
            {itemProperties.map((s) => (
              <TextField
                key={s.name}
                label={s.title ?? s.name}
                value={item[s.name] ?? ''}
                onChange={(v) => commit(items.map((it, idx) => (idx === i ? { ...it, [s.name]: v } : it)))}
              />
            ))}
          </div>
          <Button variant="destructive" onClick={() => commit(items.filter((_, idx) => idx !== i))}>
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
