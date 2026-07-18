import { useState, type KeyboardEvent } from 'react';
import { fuzzyFilter } from '@sprintster/engine';
import type { SelectOption } from './Select.js';
import styles from './RefPicker.module.css';

export interface RefPickerProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  multiple?: boolean;
  placeholder?: string | undefined;
}

export function parseRefIds(value: string, multiple: boolean): string[] {
  if (!multiple) return value === '' ? [] : [value];
  if (value.trim() === '') return [];
  try {
    const arr: unknown = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function serialize(ids: string[], multiple: boolean): string {
  return multiple ? JSON.stringify(ids) : (ids[0] ?? '');
}

function Highlighted({ label, matches }: { label: string; matches: number[] }) {
  if (matches.length === 0) return <>{label}</>;
  const set = new Set(matches);
  return (
    <>
      {[...label].map((ch, i) => (set.has(i) ? <mark key={i} className={styles.hl}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </>
  );
}

export function RefPicker({ label, value, onChange, options, multiple = false, placeholder }: RefPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selectedIds = parseRefIds(value, multiple);
  const labelById = new Map(options.map((o) => [o.value, o.label]));
  const available = options.filter((o) => !selectedIds.includes(o.value));
  const hits = fuzzyFilter(available, query);

  function commit(ids: string[]) {
    onChange(serialize(ids, multiple));
  }

  function add(id: string) {
    commit(multiple ? [...selectedIds, id] : [id]);
    setQuery('');
    setActive(0);
    if (!multiple) setOpen(false);
  }

  function remove(id: string) {
    commit(selectedIds.filter((x) => x !== id));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit !== undefined) add(hit.option.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && query === '' && multiple && selectedIds.length > 0) {
      remove(selectedIds[selectedIds.length - 1]!);
    }
  }

  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.control}>
        <div className={styles.chips}>
          {selectedIds.map((id) => {
            const text = labelById.get(id) ?? id;
            return (
              <span key={id} className={styles.chip}>
                <span className={styles.chipLabel}>{text}</span>
                <button type="button" className={styles.remove} aria-label={`Remove ${text}`} onClick={() => remove(id)}>
                  {'×'}
                </button>
              </span>
            );
          })}
          <input
            className={styles.input}
            type="search"
            aria-label={label !== undefined ? `${label} search` : 'search'}
            value={query}
            placeholder={selectedIds.length === 0 ? placeholder : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
        </div>
        {open && hits.length > 0 && (
          <ul className={styles.list} role="listbox">
            {hits.map((hit, i) => (
              <li
                key={hit.option.value}
                role="option"
                aria-label={hit.option.label}
                aria-selected={i === active}
                className={[styles.option, i === active ? styles.active : ''].filter(Boolean).join(' ')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(hit.option.value);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Highlighted label={hit.option.label} matches={hit.matches} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
