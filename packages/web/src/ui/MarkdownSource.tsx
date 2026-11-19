import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { EditorState } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { displayedAssetUrl } from '../api/assets.js';
import { CodeEditor } from './CodeEditor.js';
import { AssetDialog, type AssetKind, type AssetLibrary, type AttachedAsset } from './AssetDialog.js';
import { LinkRow, MarkdownToolbar, type ActionFlags } from './MarkdownToolbar.js';
import { useEditorHeight } from './ResizeGrip.js';
import { activeActions, applySourceLink, historyFlags, insertSourceImage, linkHref, removeSourceLink, runSourceAction } from './markdownSource.js';

// GFM, so strikethrough parses and its button can tell when it is on.
const EXTENSIONS = [markdown({ base: markdownLanguage })];

export interface MarkdownSourceProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  attach?: ((file: File) => Promise<AttachedAsset>) | undefined;
  attachDocument?: ((file: File) => Promise<AttachedAsset>) | undefined;
  library?: AssetLibrary | undefined;
  toolbarEnd?: ReactNode;
  height?: number | undefined;
  onHeightChange?: ((height: number) => void) | undefined;
}

interface Status {
  active: ActionFlags;
  disabled: ActionFlags;
  href: string | null;
}

function statusOf(state: EditorState): Status {
  return { active: activeActions(state), disabled: historyFlags(state), href: linkHref(state) };
}

// The markdown source with the rich editor's toolbar: each action writes the markdown syntax it stands for.
export function MarkdownSource({ label, value, onChange, placeholder, attach, attachDocument, library, toolbarEnd, height: givenHeight, onHeightChange }: MarkdownSourceProps) {
  const [height, setHeight] = useEditorHeight(givenHeight, onHeightChange);
  const ref = useRef<ReactCodeMirrorRef>(null);
  const [status, setStatus] = useState<Status>({ active: {}, disabled: { undo: true, redo: true }, href: null });
  const [picking, setPicking] = useState<AssetKind | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const view = () => ref.current?.view;
  const onUpdate = useCallback((update: ViewUpdate) => {
    const next = statusOf(update.state);
    setStatus((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, []);

  const toolbar = (
    <>
      <MarkdownToolbar
        active={status.active}
        disabled={status.disabled}
        hidden={{ image: attach === undefined }}
        end={toolbarEnd}
        onAction={(action) => {
          const v = view();
          if (v === undefined) return;
          if (action === 'link') setLinkOpen((open) => !open);
          else if (action === 'image') setPicking('image');
          else runSourceAction(v, action);
        }}
      />
      {(linkOpen || status.href !== null) && (
        <LinkRow
          href={status.href ?? ''}
          existing={status.href !== null}
          openUrl={displayedAssetUrl}
          onChooseFile={attachDocument === undefined ? undefined : () => setPicking('file')}
          onApply={(href) => {
            const v = view();
            if (v !== undefined) applySourceLink(v, href, href);
            setLinkOpen(false);
          }}
          onRemove={() => {
            const v = view();
            if (v !== undefined) removeSourceLink(v);
            setLinkOpen(false);
          }}
          onCancel={() => {
            setLinkOpen(false);
            view()?.focus();
          }}
        />
      )}
    </>
  );

  return (
    <>
      <CodeEditor
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        extensions={EXTENSIONS}
        toolbar={toolbar}
        editorRef={ref}
        onUpdate={onUpdate}
        resize={{ height, onResize: setHeight }}
      />
      {picking !== null && (
        <AssetDialog
          kind={picking}
          library={library}
          upload={picking === 'image' ? attach : attachDocument}
          onClose={() => setPicking(null)}
          onChoose={(asset) => {
            setPicking(null);
            const v = view();
            if (v === undefined) return;
            if (picking === 'image') insertSourceImage(v, asset.value);
            else {
              applySourceLink(v, `/assets/${asset.value}`, asset.label);
              setLinkOpen(false);
            }
          }}
        />
      )}
    </>
  );
}
