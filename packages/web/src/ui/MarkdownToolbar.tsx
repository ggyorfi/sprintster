import { useEffect, useState, type ReactNode } from 'react';
import {
  Bold,
  Check,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Redo2,
  SquareCode,
  Strikethrough,
  TextQuote,
  Undo2,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import styles from './MarkdownToolbar.module.css';

export type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
  | 'codeBlock'
  | 'link'
  | 'image'
  | 'undo'
  | 'redo';

const GROUPS: { action: MarkdownAction; label: string; Icon: LucideIcon }[][] = [
  [
    { action: 'bold', label: 'Bold', Icon: Bold },
    { action: 'italic', label: 'Italic', Icon: Italic },
    { action: 'strike', label: 'Strikethrough', Icon: Strikethrough },
    { action: 'code', label: 'Inline code', Icon: Code },
  ],
  [
    { action: 'h1', label: 'Heading 1', Icon: Heading1 },
    { action: 'h2', label: 'Heading 2', Icon: Heading2 },
    { action: 'h3', label: 'Heading 3', Icon: Heading3 },
  ],
  [
    { action: 'bulletList', label: 'Bullet list', Icon: List },
    { action: 'orderedList', label: 'Ordered list', Icon: ListOrdered },
    { action: 'blockquote', label: 'Blockquote', Icon: TextQuote },
    { action: 'codeBlock', label: 'Code block', Icon: SquareCode },
  ],
  [
    { action: 'link', label: 'Link', Icon: Link },
    { action: 'image', label: 'Insert image', Icon: Image },
  ],
  [
    { action: 'undo', label: 'Undo', Icon: Undo2 },
    { action: 'redo', label: 'Redo', Icon: Redo2 },
  ],
];

const ICON = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const;

export type ActionFlags = Partial<Record<MarkdownAction, boolean>>;

export interface MarkdownToolbarProps {
  active: ActionFlags;
  disabled?: ActionFlags;
  // Actions this editor cannot offer, e.g. images without an assets object.
  hidden?: ActionFlags;
  onAction: (action: MarkdownAction) => void;
  // Right-aligned, e.g. the rich/source switch.
  end?: ReactNode;
}

export function MarkdownToolbar({ active, disabled = {}, hidden = {}, onAction, end }: MarkdownToolbarProps) {
  const groups = GROUPS.map((g) => g.filter((b) => hidden[b.action] !== true)).filter((g) => g.length > 0);
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      {groups.map((group, i) => (
        <span key={group[0]!.action} className={styles.group}>
          {i > 0 && <span className={styles.sep} />}
          {group.map(({ action, label, Icon }) => (
            <button
              key={action}
              type="button"
              className={[styles.tbtn, active[action] === true ? styles.tactive : ''].filter(Boolean).join(' ')}
              aria-label={label}
              aria-pressed={action === 'undo' || action === 'redo' ? undefined : active[action] === true}
              title={label}
              disabled={disabled[action] === true}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAction(action)}
            >
              <Icon {...ICON} />
            </button>
          ))}
        </span>
      ))}
      {end !== undefined && <span className={styles.end}>{end}</span>}
    </div>
  );
}

export interface LinkRowProps {
  href: string;
  // The selection already is a link: offer to remove it.
  existing: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
  onChooseFile?: (() => void) | undefined;
  // The URL to open a link with; a stored asset link resolves against the API.
  openUrl: (href: string) => string;
}

export function LinkRow({ href, existing, onApply, onRemove, onCancel, onChooseFile, openUrl }: LinkRowProps) {
  const [draft, setDraft] = useState(href);
  useEffect(() => setDraft(href), [href]);
  const apply = () => onApply(draft.trim());

  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>Link</span>
      <input
        type="text"
        aria-label="Link URL"
        className={styles.rowInput}
        value={draft}
        placeholder="https://… or /path"
        autoFocus={!existing}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button type="button" className={styles.tbtn} aria-label="Apply link" title="Apply link" disabled={draft.trim() === '' || draft.trim() === href} onClick={apply}>
        <Check {...ICON} />
      </button>
      {onChooseFile !== undefined && (
        <button type="button" className={styles.tbtn} aria-label="Link a file" title="Link a file" onClick={onChooseFile}>
          <Paperclip {...ICON} />
        </button>
      )}
      {href !== '' && (
        <a className={styles.tbtn} href={openUrl(href)} target="_blank" rel="noreferrer" aria-label="Open link" title="Open link">
          <ExternalLink {...ICON} />
        </a>
      )}
      {existing && (
        <button type="button" className={styles.tbtn} aria-label="Remove link" title="Remove link" onClick={onRemove}>
          <Unlink {...ICON} />
        </button>
      )}
    </div>
  );
}

// Alt text lives in the markdown, so it has to be authorable; a prompt on insert would be hostile when pasting screenshots.
export function AltRow({ alt, onChange }: { alt: string; onChange: (alt: string) => void }) {
  return (
    <label className={styles.row}>
      <span className={styles.rowLabel}>Alt text</span>
      <input type="text" className={styles.rowInput} value={alt} placeholder="Describe the image" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
