import { useState, type DragEvent } from 'react';
import { CardChooser, Picture } from './CardChooser.js';
import { parseRefIds } from './RefPicker.js';
import type { SelectOption } from './Select.js';
import styles from './RefCards.module.css';

export interface RefCardsProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  multiple?: boolean;
  // Creates a target record from a file; offered in the dialog when given.
  upload?: ((file: File) => Promise<SelectOption>) | undefined;
  // ADR 24: the server searches; `options` are then its answer plus the chosen records.
  onSearch?: ((query: string) => void) | undefined;
}

// A ref or refs field whose targets carry pictures: the chosen records as reorderable cards, and a dialog grid to choose more.
export function RefCards({ label, value, onChange, options: given, multiple = false, upload, onSearch }: RefCardsProps) {
  const [choosing, setChoosing] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  const [uploaded, setUploaded] = useState<SelectOption[]>([]);

  const options = [...uploaded, ...given.filter((o) => !uploaded.some((u) => u.value === o.value))];
  const ids = parseRefIds(value, multiple);
  const byId = new Map(options.map((o) => [o.value, o]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const commit = (next: string[]) => onChange(multiple ? JSON.stringify(next) : (next[0] ?? ''));
  const choosable = options.filter((o) => !multiple || !ids.includes(o.value));

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
  }

  function onDrop(e: DragEvent, index: number) {
    e.preventDefault();
    if (dragging !== null) move(dragging, index);
    setDragging(null);
  }

  return (
    <div className={styles.field} role="group" aria-label={label}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <ul className={styles.cards}>
        {ids.map((id, i) => (
          <li
            key={id}
            className={[styles.card, dragging === i ? styles.dragging : ''].filter(Boolean).join(' ')}
            draggable={multiple}
            onDragStart={() => setDragging(i)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, i)}
          >
            <Picture option={byId.get(id)} />
            <span className={styles.name} title={name(id)}>
              {multiple && <span className={styles.position}>{i + 1}</span>}
              {name(id)}
            </span>
            <span className={styles.tools}>
              {multiple && (
                <>
                  <button type="button" aria-label={`Move ${name(id)} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    {'‹'}
                  </button>
                  <button type="button" aria-label={`Move ${name(id)} later`} disabled={i === ids.length - 1} onClick={() => move(i, i + 1)}>
                    {'›'}
                  </button>
                </>
              )}
              <button type="button" aria-label={`Remove ${name(id)}`} onClick={() => commit(ids.filter((x) => x !== id))}>
                {'×'}
              </button>
            </span>
          </li>
        ))}
        <li>
          <button type="button" className={styles.add} onClick={() => setChoosing(true)}>
            <span aria-hidden="true">+</span>
            {multiple ? 'Add' : ids.length > 0 ? 'Change' : 'Choose'}
          </button>
        </li>
      </ul>
      {choosing && (
        <CardChooser
          title={label !== undefined ? `Choose: ${label}` : 'Choose'}
          options={choosable}
          multiple={multiple}
          current={ids[0]}
          onSearch={onSearch}
          upload={upload}
          accept="image/*"
          onUploaded={(option) => setUploaded((list) => [option, ...list])}
          onChoose={(chosen) => {
            commit(multiple ? [...ids, ...chosen] : chosen);
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
