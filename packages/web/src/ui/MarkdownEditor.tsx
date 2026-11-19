import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor, useEditorState, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import { assetUrl, storedAssetUrl, displayedAssetUrl } from '../api/assets.js';
import { useAssetUpload } from './useAssetUpload.js';
import { AssetDialog, type AssetKind, type AssetLibrary, type AttachedAsset } from './AssetDialog.js';
import { AltRow, LinkRow, MarkdownToolbar, type MarkdownAction } from './MarkdownToolbar.js';
import { ResizeGrip, heightStyle, useEditorHeight } from './ResizeGrip.js';
import styles from './MarkdownEditor.module.css';

// Serialising is the one path every edit goes through, so it is where the root-relative rule is enforced rather than assumed.
const AssetImage = Image.extend({
  addAttributes() {
    const attributes: Record<string, object> = this.parent?.() ?? {};
    return { ...attributes, src: { ...attributes['src'], parseHTML: (el: HTMLElement) => displayedAssetUrl(el.getAttribute('src') ?? '') } };
  },
  parseMarkdown: (token, helpers) =>
    helpers.createNode('image', {
      src: displayedAssetUrl(String(token['href'] ?? '')),
      title: token['title'],
      alt: token['text'],
    }),
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
  attach?: ((file: File) => Promise<AttachedAsset>) | undefined;
  attachDocument?: ((file: File) => Promise<AttachedAsset>) | undefined;
  library?: AssetLibrary | undefined;
  toolbarEnd?: ReactNode;
  height?: number | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
}

function imageFilesOf(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

// The node holds a displayable src; the serialiser is what makes it root-relative again, so insert can use the resolved URL.
function insertImage(editor: Editor, assetId: string, at: number | null) {
  if (editor.isDestroyed) return;
  editor
    .chain()
    .focus()
    // Collapse past whatever is selected, so inserting next to a selected image adds one rather than replacing it.
    .setTextSelection(at ?? editor.state.selection.to)
    .setImage({ src: assetUrl(assetId), alt: '' })
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

// The link stays root-relative, as stored content must (ADR 9), so the body does not depend on where the API is mounted.
function applyLink(editor: Editor, href: string, text: string) {
  if (editor.isDestroyed) return;
  if (editor.isActive('link') || !editor.state.selection.empty) {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
    .unsetMark('link')
    .run();
}

function Toolbar({ editor, images, end, onLink, onImage }: { editor: Editor; images: boolean; end: ReactNode; onLink: () => void; onImage: () => void }) {
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
        link: on('link'),
        canUndo: live ? editor.can().undo() : false,
        canRedo: live ? editor.can().redo() : false,
      };
    },
  });

  function run(action: MarkdownAction) {
    if (editor.isDestroyed) return;
    const chain = () => editor.chain().focus();
    const commands: Record<MarkdownAction, () => void> = {
      bold: () => chain().toggleBold().run(),
      italic: () => chain().toggleItalic().run(),
      strike: () => chain().toggleStrike().run(),
      code: () => chain().toggleCode().run(),
      h1: () => chain().toggleHeading({ level: 1 }).run(),
      h2: () => chain().toggleHeading({ level: 2 }).run(),
      h3: () => chain().toggleHeading({ level: 3 }).run(),
      bulletList: () => chain().toggleBulletList().run(),
      orderedList: () => chain().toggleOrderedList().run(),
      blockquote: () => chain().toggleBlockquote().run(),
      codeBlock: () => chain().toggleCodeBlock().run(),
      link: onLink,
      image: onImage,
      undo: () => chain().undo().run(),
      redo: () => chain().redo().run(),
    };
    commands[action]();
  }

  return <MarkdownToolbar active={s} disabled={{ undo: !s.canUndo, redo: !s.canRedo }} hidden={{ image: !images }} onAction={run} end={end} />;
}

function Rows({
  editor,
  linkOpen,
  closeLink,
  onChooseFile,
}: {
  editor: Editor;
  linkOpen: boolean;
  closeLink: () => void;
  onChooseFile: (() => void) | undefined;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => {
      const live = editor !== null && !editor.isDestroyed;
      const image = live && editor.isActive('image');
      const link = live && editor.isActive('link');
      return {
        image,
        alt: image ? String(editor.getAttributes('image')['alt'] ?? '') : '',
        link,
        href: link ? String(editor.getAttributes('link')['href'] ?? '') : '',
      };
    },
  });

  return (
    <>
      {s.image && (
        <AltRow
          alt={s.alt}
          onChange={(alt) => {
            if (!editor.isDestroyed) editor.commands.updateAttributes('image', { alt });
          }}
        />
      )}
      {(linkOpen || s.link) && (
        <LinkRow
          href={s.href}
          existing={s.link}
          openUrl={displayedAssetUrl}
          onChooseFile={onChooseFile}
          onApply={(href) => {
            applyLink(editor, href, href);
            closeLink();
          }}
          onRemove={() => {
            if (!editor.isDestroyed) editor.chain().focus().extendMarkRange('link').unsetLink().run();
            closeLink();
          }}
          onCancel={() => {
            closeLink();
            if (!editor.isDestroyed) editor.commands.focus();
          }}
        />
      )}
    </>
  );
}

// WYSIWYG markdown editor: markdown shortcuts format in place, value stays a raw markdown string.
export function MarkdownEditor({ label, value, onChange, readOnly = false, attach, attachDocument, library, toolbarEnd, height: givenHeight, onHeightChange }: MarkdownEditorProps) {
  const [height, setHeight] = useEditorHeight(givenHeight, onHeightChange);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [picking, setPicking] = useState<AssetKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const uploader = useAssetUpload(attach, { imagesOnly: true });
  const uploadRef = useRef(uploader);
  uploadRef.current = uploader;
  const editorRef = useRef<Editor | null>(null);

  // Paste and drop reach the same upload path as the toolbar; the editor is created once, so the handlers read through refs.
  async function uploadInto(files: File[], at: number | null) {
    for (const file of files) {
      const asset = await uploadRef.current.select(file);
      const editor = editorRef.current;
      if (asset !== null && editor !== null) insertImage(editor, asset.id, at);
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
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, AssetImage],
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
    if (editor === null || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // An image whose blob has gone shows as a labelled placeholder rather than a broken icon. Load errors do not bubble, so capture.
  useEffect(() => {
    // isDestroyed, not a null check: tiptap's `view` is a proxy that throws for `dom` while the view is gone.
    if (editor === null || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const mark = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) target.setAttribute('data-missing', 'true');
    };
    dom.addEventListener('error', mark, true);
    return () => dom.removeEventListener('error', mark, true);
  }, [editor]);

  useEffect(() => {
    // destroy() nulls commandManager, so `commands` throws on a torn-down editor just as `view.dom` does.
    if (editor === null || editor.isDestroyed) return;
    if (value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  const editing = editor !== null && !readOnly;

  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.editor} style={heightStyle(height)}>
        {editing && (
          <Toolbar
            editor={editor}
            images={attach !== undefined}
            end={toolbarEnd}
            onLink={() => setLinkOpen((open) => !open)}
            onImage={() => setPicking('image')}
          />
        )}
        {editing && (
          <Rows
            editor={editor}
            linkOpen={linkOpen}
            closeLink={() => setLinkOpen(false)}
            onChooseFile={attachDocument === undefined ? undefined : () => setPicking('file')}
          />
        )}
        {uploader.error !== null && (
          <span role="alert" className={styles.error}>
            {uploader.error}
          </span>
        )}
        <EditorContent editor={editor} />
        {editing && <ResizeGrip target={() => (editor.isDestroyed ? null : editor.view.dom)} onResize={setHeight} />}
      </div>
      {editing && picking !== null && (
        <AssetDialog
          kind={picking}
          library={library}
          upload={picking === 'image' ? attach : attachDocument}
          onClose={() => setPicking(null)}
          onChoose={(asset) => {
            setPicking(null);
            if (picking === 'image') insertImage(editor, asset.value, null);
            else {
              applyLink(editor, `/assets/${asset.value}`, asset.label);
              setLinkOpen(false);
            }
          }}
        />
      )}
    </div>
  );
}
