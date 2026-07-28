import { useEffect, useRef } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import { assetUrl, storedAssetUrl, type UploadedAsset } from '../api/assets.js';
import { useAssetUpload, type AssetUpload } from './useAssetUpload.js';
import styles from './MarkdownEditor.module.css';

// Serialising is the one path every edit goes through, so it is where the root-relative rule is enforced rather than assumed.
const AssetImage = Image.extend({
  renderMarkdown: (node) => {
    const src = storedAssetUrl(String(node.attrs?.['src'] ?? ''));
    const alt = String(node.attrs?.['alt'] ?? '');
    const title = String(node.attrs?.['title'] ?? '');
    return title === '' ? `![${alt}](${src})` : `![${alt}](${src} "${title}")`;
  },
}).configure({ inline: false, allowBase64: false, resize: false });

export interface MarkdownEditorProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  upload?: ((file: File) => Promise<UploadedAsset>) | undefined;
}

function imageFilesOf(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

// The node holds a displayable src; the serialiser is what makes it root-relative again, so insert can use the resolved URL.
function insertImage(editor: Editor, hash: string, at: number | null) {
  editor
    .chain()
    .focus()
    // Collapse past whatever is selected, so inserting next to a selected image adds one rather than replacing it.
    .setTextSelection(at ?? editor.state.selection.to)
    .setImage({ src: assetUrl(hash), alt: '' })
    // Leave the new image selected, so its alt field appears without the author having to know to click it.
    .command(({ tr, dispatch }) => {
      if (dispatch === undefined) return true;
      for (let pos = tr.selection.from; pos >= 0; pos -= 1) {
        if (tr.doc.nodeAt(pos)?.type.name === 'image') {
          tr.setSelection(NodeSelection.create(tr.doc, pos));
          break;
        }
      }
      return true;
    })
    .run();
}

function ImageButton({ editor, uploader }: { editor: Editor; uploader: AssetUpload }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, error, select } = uploader;

  async function onFile(file: File | undefined) {
    const asset = await select(file);
    if (asset === null) return;
    insertImage(editor, asset.hash, null);
  }

  return (
    <>
      <button
        type="button"
        className={styles.tbtn}
        aria-label="Insert image"
        title="Insert image"
        disabled={busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? '…' : 'IMG'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.fileInput}
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {error !== null && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </>
  );
}

// Alt text lives in the markdown, so it has to be authorable; a prompt on insert would be hostile when pasting screenshots.
function AltTextRow({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      const live = editor !== null && !editor.isDestroyed;
      const selected = live && editor.isActive('image');
      return { selected, alt: selected ? String(editor.getAttributes('image')['alt'] ?? '') : '' };
    },
  });

  if (!s.selected) return null;

  return (
    <label className={styles.altRow}>
      <span className={styles.altLabel}>Alt text</span>
      <input
        type="text"
        className={styles.altInput}
        value={s.alt}
        placeholder="Describe the image"
        onChange={(e) => editor.commands.updateAttributes('image', { alt: e.target.value })}
      />
    </label>
  );
}

function Toolbar({ editor, uploader }: { editor: Editor; uploader: AssetUpload | null }) {
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
      {uploader !== null && <span className={styles.sep} />}
      {uploader !== null && <ImageButton editor={editor} uploader={uploader} />}
      <span className={styles.sep} />
      {btn('Undo', '↺', false, () => chain().undo().run(), !s.canUndo)}
      {btn('Redo', '↻', false, () => chain().redo().run(), !s.canRedo)}
    </div>
  );
}

// WYSIWYG markdown editor: markdown shortcuts format in place, value stays a raw markdown string.
export function MarkdownEditor({ label, value, onChange, readOnly = false, upload }: MarkdownEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const uploader = useAssetUpload(upload);
  const uploadRef = useRef(uploader);
  uploadRef.current = uploader;
  const editorRef = useRef<Editor | null>(null);

  // Paste and drop reach the same upload path as the toolbar; the editor is created once, so the handlers read through refs.
  async function uploadInto(files: File[], at: number | null) {
    for (const file of files) {
      const asset = await uploadRef.current.select(file);
      const editor = editorRef.current;
      if (asset !== null && editor !== null) insertImage(editor, asset.hash, at);
    }
  }

  function claimImages(event: Event, data: DataTransfer | null, at: number | null): boolean {
    const files = imageFilesOf(data);
    if (files.length === 0) return false;
    event.preventDefault();
    void uploadInto(files, at);
    return true;
  }

  const editor = useEditor({
    extensions: [StarterKit, Markdown, AssetImage],
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    onUpdate: ({ editor }) => onChangeRef.current(editor.getMarkdown()),
    editorProps: {
      // handleDrop is unreachable without layout: prosemirror-view bails when posAtCoords finds nothing, so claim the DOM events instead.
      handleDOMEvents: {
        paste: (_view, event) => claimImages(event, event.clipboardData, null),
        drop: (view, event) => {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
          return claimImages(event, event.dataTransfer, at);
        },
      },
    },
  });
  editorRef.current = editor;

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
        {editor !== null && !readOnly && <Toolbar editor={editor} uploader={upload === undefined ? null : uploader} />}
        {editor !== null && !readOnly && <AltTextRow editor={editor} />}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
