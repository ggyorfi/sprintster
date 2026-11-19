import { useRef, useState } from 'react';
import { fuzzyFilter } from '@sprintster/engine';
import { FileText } from 'lucide-react';
import { Button } from './Button.js';
import { Modal } from './Modal.js';
import type { SelectOption } from './Select.js';
import { preparedUpload } from './useAssetUpload.js';
import styles from './CardChooser.module.css';

export function Picture({ option }: { option: SelectOption | undefined }) {
  return option?.thumb !== undefined ? (
    <img className={styles.picture} src={option.thumb} alt="" loading="lazy" />
  ) : (
    <span className={`${styles.picture} ${styles.blank}`} aria-hidden="true">
      <FileText size={28} strokeWidth={1.5} />
    </span>
  );
}

export interface CardChooserProps {
  title: string;
  options: SelectOption[];
  multiple?: boolean;
  // Single choice: the record chosen now, shown pressed.
  current?: string | undefined;
  // ADR 24: the server searches; `options` are then its answer.
  onSearch?: ((query: string) => void) | undefined;
  // Creates a target record from a file; offered in the dialog when given.
  upload?: ((file: File) => Promise<SelectOption>) | undefined;
  onUploaded?: (option: SelectOption) => void;
  imagesOnly?: boolean;
  accept?: string | undefined;
  onChoose: (ids: string[]) => void;
  onClose: () => void;
}

// A dialog grid of records with pictures: search, pick one or several, or upload new ones.
export function CardChooser({
  title,
  options,
  multiple = false,
  current,
  onSearch,
  upload,
  onUploaded,
  imagesOnly = true,
  accept,
  onChoose,
  onClose,
}: CardChooserProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hits = onSearch === undefined ? fuzzyFilter(options, query) : options.map((option) => ({ option, matches: [] as number[] }));

  function choose(id: string) {
    if (!multiple) {
      onChoose([id]);
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
        const option = await upload(await preparedUpload(file, { imagesOnly }));
        onUploaded?.(option);
        if (!multiple) {
          onChoose([option.value]);
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

  return (
    <Modal
      title={title}
      width="large"
      onClose={onClose}
      footer={
        multiple ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={picked.length === 0} onClick={() => onChoose(picked)}>
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
          onChange={(e) => {
            setQuery(e.target.value);
            onSearch?.(e.target.value);
          }}
        />
        {upload !== undefined && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={accept}
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
      {uploadError !== null && (
        <p className={styles.uploadError} role="alert">
          {uploadError}
        </p>
      )}
      {hits.length === 0 ? (
        <p className={styles.empty}>Nothing to choose.</p>
      ) : (
        <ul className={styles.grid}>
          {hits.map(({ option }) => {
            const on = picked.includes(option.value) || (!multiple && current === option.value);
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
  );
}
