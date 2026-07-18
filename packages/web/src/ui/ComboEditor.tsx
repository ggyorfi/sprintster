import { useState } from 'react';
import { CodeEditor } from './CodeEditor.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import styles from './ComboEditor.module.css';

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
      {mode === 'wysiwyg' ? (
        <MarkdownEditor value={value} onChange={onChange} />
      ) : (
        <CodeEditor value={value} onChange={onChange} language="markdown" />
      )}
    </div>
  );
}
