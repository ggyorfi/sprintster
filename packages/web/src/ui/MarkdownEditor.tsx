import { useEffect, useRef } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import styles from './MarkdownEditor.module.css';

export interface MarkdownEditorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    // The editor can be torn down mid-render (React strict/concurrent, combo toggles); guard against a destroyed instance.
    selector: ({ editor }) => {
      const live = editor !== null && !editor.isDestroyed;
      const on = (name: string, attrs?: Record<string, unknown>) => (live ? editor.isActive(name, attrs) : false);
      return {
        bold: on('bold'),
        italic: on('italic'),
        strike: on('strike'),
        code: on('code'),
        h1: on('heading', { level: 1 }),
        h2: on('heading', { level: 2 }),
        h3: on('heading', { level: 3 }),
        bulletList: on('bulletList'),
        orderedList: on('orderedList'),
        blockquote: on('blockquote'),
        codeBlock: on('codeBlock'),
        canUndo: live ? editor.can().undo() : false,
        canRedo: live ? editor.can().redo() : false,
      };
    },
  });

  const chain = () => editor.chain().focus();

  const btn = (name: string, glyph: string, active: boolean, run: () => void, disabled = false) => (
    <button
      type="button"
      className={[styles.tbtn, active ? styles.tactive : ''].filter(Boolean).join(' ')}
      aria-label={name}
      aria-pressed={active}
      title={name}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {glyph}
    </button>
  );

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      {btn('Bold', 'B', s.bold, () => chain().toggleBold().run())}
      {btn('Italic', 'I', s.italic, () => chain().toggleItalic().run())}
      {btn('Strikethrough', 'S', s.strike, () => chain().toggleStrike().run())}
      {btn('Inline code', '</>', s.code, () => chain().toggleCode().run())}
      <span className={styles.sep} />
      {btn('Heading 1', 'H1', s.h1, () => chain().toggleHeading({ level: 1 }).run())}
      {btn('Heading 2', 'H2', s.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn('Heading 3', 'H3', s.h3, () => chain().toggleHeading({ level: 3 }).run())}
      <span className={styles.sep} />
      {btn('Bullet list', '•', s.bulletList, () => chain().toggleBulletList().run())}
      {btn('Ordered list', '1.', s.orderedList, () => chain().toggleOrderedList().run())}
      {btn('Blockquote', '❝', s.blockquote, () => chain().toggleBlockquote().run())}
      {btn('Code block', '{ }', s.codeBlock, () => chain().toggleCodeBlock().run())}
      <span className={styles.sep} />
      {btn('Undo', '↺', false, () => chain().undo().run(), !s.canUndo)}
      {btn('Redo', '↻', false, () => chain().redo().run(), !s.canRedo)}
    </div>
  );
}

// WYSIWYG markdown editor: markdown shortcuts format in place, value stays a raw markdown string.
export function MarkdownEditor({ label, value, onChange, readOnly = false }: MarkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    if (value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.editor}>
        {editor !== null && !readOnly && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
