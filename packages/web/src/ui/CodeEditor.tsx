import { useRef, type ReactNode, type Ref } from 'react';
import CodeMirror, { type Extension, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { ViewUpdate } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { ResizeGrip, heightStyle } from './ResizeGrip.js';
import styles from './CodeEditor.module.css';

// Known languages map to a CodeMirror extension; plaintext and anything unrecognised get no highlighting.
export function codeExtensions(language?: string): Extension[] {
  switch (language) {
    case 'markdown':
      return [markdown()];
    case 'html':
      return [html()];
    case 'css':
      return [css()];
    case 'json':
      return [json()];
    default:
      return [];
  }
}

export interface CodeEditorProps {
  label?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  language?: string | undefined;
  readOnly?: boolean;
  placeholder?: string | undefined;
  // Replaces the language's extensions.
  extensions?: Extension[] | undefined;
  toolbar?: ReactNode;
  editorRef?: Ref<ReactCodeMirrorRef> | undefined;
  onUpdate?: ((update: ViewUpdate) => void) | undefined;
  // Shows a grip to resize the editor.
  resize?: { height: number | undefined; onResize: (height: number) => void } | undefined;
}

export function CodeEditor({ label, value, onChange, language, readOnly, placeholder, extensions, toolbar, editorRef, onUpdate, resize }: CodeEditorProps) {
  const frame = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div ref={frame} className={styles.editor} style={heightStyle(resize?.height)}>
        {toolbar}
        <CodeMirror
          ref={editorRef}
          value={value}
          onChange={onChange}
          extensions={extensions ?? codeExtensions(language)}
          readOnly={readOnly ?? false}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: readOnly !== true }}
          {...(placeholder !== undefined ? { placeholder } : {})}
          {...(onUpdate !== undefined ? { onUpdate } : {})}
        />
        {resize !== undefined && <ResizeGrip target={() => frame.current?.querySelector('.cm-editor')} onResize={resize.onResize} />}
      </div>
    </div>
  );
}
