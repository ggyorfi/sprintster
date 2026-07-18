import { lazy, Suspense, useState } from 'react';
import styles from './ComboEditor.module.css';

// Lazy so the source editor's CodeMirror chunk only loads when the author toggles to Source (combo opens in WYSIWYG).
const CodeEditor = lazy(() => import('./CodeEditor.js').then((m) => ({ default: m.CodeEditor })));
const MarkdownEditor = lazy(() => import('./MarkdownEditor.js').then((m) => ({ default: m.MarkdownEditor })));

export type ComboMode = 'wysiwyg' | 'source';

export interface ComboEditorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  defaultMode?: ComboMode;
}

// Strictly composes the WYSIWYG (MarkdownEditor) and source (CodeEditor) widgets over one shared markdown string.
export function ComboEditor({ label, value, onChange, defaultMode = 'wysiwyg' }: ComboEditorProps) {
  const [mode, setMode] = useState<ComboMode>(defaultMode);
  return (
    <div className={styles.field}>
      <div className={styles.header}>
        {label !== undefined && <span className={styles.label}>{label}</span>}
        <div className={styles.toggle} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'wysiwyg'}
            className={[styles.tab, mode === 'wysiwyg' ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => setMode('wysiwyg')}
          >
            Rich
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'source'}
            className={[styles.tab, mode === 'source' ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
      </div>
      <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
        {mode === 'wysiwyg' ? (
          <MarkdownEditor value={value} onChange={onChange} />
        ) : (
          <CodeEditor value={value} onChange={onChange} language="markdown" />
        )}
      </Suspense>
    </div>
  );
}
