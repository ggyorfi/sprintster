import { useRef, useState, type DragEvent } from 'react';
import { assetUploadProblem, ASSET_HEADER_BYTES, fuzzyFilter } from '@sprintster/engine';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
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
}

function Picture({ option }: { option: SelectOption | undefined }) {
  return option?.thumb !== undefined ? (
    <img className={styles.picture} src={option.thumb} alt="" loading="lazy" />
  ) : (
    <span className={styles.picture} aria-hidden="true" />
  );
}

// A ref or refs field whose targets carry pictures: the chosen records as reorderable cards, and a dialog grid to choose more.
export function RefCards({ label, value, onChange, options: given, multiple = false, upload }: RefCardsProps) {
  const [choosing, setChoosing] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);

  const [uploaded, setUploaded] = useState<SelectOption[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const options = [...uploaded, ...given.filter((o) => !uploaded.some((u) => u.value === o.value))];
  const ids = parseRefIds(value, multiple);
  const byId = new Map(options.map((o) => [o.value, o]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  const commit = (next: string[]) => onChange(multiple ? JSON.stringify(next) : (next[0] ?? ''));
  const hits = fuzzyFilter(
    options.filter((o) => !multiple || !ids.includes(o.value)),
    query,
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    commit(next);
  }

  function open() {
    setQuery('');
    setPicked([]);
    setUploadError(null);
    setChoosing(true);
  }

  function choose(id: string) {
    if (!multiple) {
      commit([id]);
      setChoosing(false);
      return;
    }
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  // One at a time; a file that fails is reported and the others still go in.
  async function addFiles(files: File[]) {
    if (upload === undefined || files.length === 0) return;
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}...`);
      try {
        const header = new Uint8Array(await file.slice(0, ASSET_HEADER_BYTES).arrayBuffer());
        const problem = assetUploadProblem(file.size, header, { imagesOnly: true });
        if (problem !== null) throw new Error(problem);
        const option = await upload(file);
        setUploaded((list) => [option, ...list]);
        if (!multiple) {
          commit([option.value]);
          setChoosing(false);
          break;
        }
        setPicked((p) => [...p, option.value]);
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    setProgress(null);
    setUploadError(failed.length > 0 ? failed.join('; ') : null);
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
          <button type="button" className={styles.add} onClick={open}>
            <span aria-hidden="true">+</span>
            {multiple ? 'Add' : ids.length > 0 ? 'Change' : 'Choose'}
          </button>
        </li>
      </ul>
      {choosing && (
        <Modal
          title={label !== undefined ? `Choose: ${label}` : 'Choose'}
          width="large"
          onClose={() => setChoosing(false)}
          footer={
            multiple ? (
              <>
                <Button onClick={() => setChoosing(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={picked.length === 0}
                  onClick={() => {
                    commit([...ids, ...picked]);
                    setChoosing(false);
                  }}
                >
                  {picked.length > 0 ? `Add ${picked.length}` : 'Add'}
                </Button>
              </>
            ) : undefined
          }
        >
          <div
            className={styles.toolbar}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles([...e.dataTransfer.files]);
            }}
          >
          <input
            className={styles.search}
            type="search"
            aria-label="Search"
            placeholder="Search..."
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {upload !== undefined && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple={multiple}
                hidden
                aria-label="Upload files"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <Button variant="additive" disabled={progress !== null} onClick={() => fileInput.current?.click()}>
                {progress ?? 'Upload'}
              </Button>
            </>
          )}
          </div>
          {uploadError !== null && <p className={styles.uploadError} role="alert">{uploadError}</p>}
          {hits.length === 0 ? (
            <p className={styles.empty}>Nothing to choose.</p>
          ) : (
            <ul className={styles.grid}>
              {hits.map(({ option }) => {
                const on = picked.includes(option.value) || (!multiple && ids[0] === option.value);
                return (
                  <li key={option.value}>
                    <button type="button" className={styles.choice} aria-pressed={on} onClick={() => choose(option.value)}>
                      <Picture option={option} />
                      <span className={styles.name}>{option.label}</span>
                      {on && multiple && <span className={styles.check}>{picked.indexOf(option.value) + 1}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}
