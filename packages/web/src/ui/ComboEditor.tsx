import { lazy, Suspense, useState, type ReactNode } from 'react';
import { CodeXml, Eye } from 'lucide-react';
import type { AssetLibrary, AttachedAsset } from './AssetDialog.js';
import styles from './ComboEditor.module.css';

// Lazy so the source editor's CodeMirror chunk only loads when the author toggles to Source (combo opens in WYSIWYG).
const MarkdownSource = lazy(() => import('./MarkdownSource.js').then((m) => ({ default: m.MarkdownSource })));
const MarkdownEditor = lazy(() => import('./MarkdownEditor.js').then((m) => ({ default: m.MarkdownEditor })));

export type ComboMode = 'wysiwyg' | 'source';

export interface ComboEditorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  defaultMode?: ComboMode;
  attach?: ((file: File) => Promise<AttachedAsset>) | undefined;
  attachDocument?: ((file: File) => Promise<AttachedAsset>) | undefined;
  library?: AssetLibrary | undefined;
}

// Strictly composes the WYSIWYG (MarkdownEditor) and source (MarkdownSource) widgets over one shared markdown string.
export function ComboEditor({ label, value, onChange, defaultMode = 'wysiwyg', attach, attachDocument, library }: ComboEditorProps) {
  const [mode, setMode] = useState<ComboMode>(defaultMode);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const tab = (to: ComboMode, text: string, icon: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === to}
      aria-label={text}
      title={text}
      className={[styles.tab, mode === to ? styles.active : ''].filter(Boolean).join(' ')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setMode(to)}
    >
      {icon}
    </button>
  );
  const toggle = (
    <div className={styles.toggle} role="tablist">
      {tab('wysiwyg', 'Rich', <Eye size={15} aria-hidden />)}
      {tab('source', 'Source', <CodeXml size={15} aria-hidden />)}
    </div>
  );
  const shared = { value, onChange, attach, attachDocument, library, toolbarEnd: toggle, height, onHeightChange: setHeight };
  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
        {mode === 'wysiwyg' ? <MarkdownEditor {...shared} /> : <MarkdownSource {...shared} />}
      </Suspense>
    </div>
  );
}
