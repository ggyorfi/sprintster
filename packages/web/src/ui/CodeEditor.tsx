import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
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
  label?: string;
  value: string;
  onChange: (value: string) => void;
  language?: string | undefined;
  readOnly?: boolean;
  placeholder?: string | undefined;
}

export function CodeEditor({ label, value, onChange, language, readOnly, placeholder }: CodeEditorProps) {
  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.editor}>
        <CodeMirror
          value={value}
          onChange={onChange}
          extensions={codeExtensions(language)}
          readOnly={readOnly ?? false}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: readOnly !== true }}
          {...(placeholder !== undefined ? { placeholder } : {})}
        />
      </div>
    </div>
  );
}
