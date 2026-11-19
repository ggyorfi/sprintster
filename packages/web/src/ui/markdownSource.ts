import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { SyntaxNode } from '@lezer/common';
import type { ActionFlags, MarkdownAction } from './MarkdownToolbar.js';

type InlineAction = 'bold' | 'italic' | 'strike' | 'code';

const INLINE: Record<InlineAction, { node: string; mark: string }> = {
  bold: { node: 'StrongEmphasis', mark: '**' },
  italic: { node: 'Emphasis', mark: '*' },
  strike: { node: 'Strikethrough', mark: '~~' },
  code: { node: 'InlineCode', mark: '`' },
};

const HEADING = /^#{1,6}\s+/;
const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const QUOTE = /^>\s?/;

function enclosing(state: EditorState, name: string): SyntaxNode | null {
  const { from, empty, head } = state.selection.main;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(empty ? head : from, empty ? -1 : 1); n !== null; n = n.parent) {
    if (n.name === name) return n;
  }
  return null;
}

function selectedLines(state: EditorState) {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  return Array.from({ length: last - first + 1 }, (_, i) => state.doc.line(first + i));
}

function headingLevel(text: string): number {
  return HEADING.exec(text)?.[0].trim().length ?? 0;
}

export function activeActions(state: EditorState): ActionFlags {
  const line = state.doc.lineAt(state.selection.main.head).text;
  const level = headingLevel(line);
  return {
    bold: enclosing(state, INLINE.bold.node) !== null,
    italic: enclosing(state, INLINE.italic.node) !== null,
    strike: enclosing(state, INLINE.strike.node) !== null,
    code: enclosing(state, INLINE.code.node) !== null,
    h1: level === 1,
    h2: level === 2,
    h3: level === 3,
    bulletList: BULLET.test(line),
    orderedList: ORDERED.test(line),
    blockquote: QUOTE.test(line),
    codeBlock: enclosing(state, 'FencedCode') !== null,
    link: enclosing(state, 'Link') !== null,
  };
}

export function historyFlags(state: EditorState): ActionFlags {
  return { undo: undoDepth(state) === 0, redo: redoDepth(state) === 0 };
}

function toggleInline(view: EditorView, action: InlineAction) {
  const { node, mark } = INLINE[action];
  const state = view.state;
  const found = enclosing(state, node);
  if (found !== null) {
    const open = found.firstChild;
    const close = found.lastChild;
    if (open === null || close === null || open === close) return;
    view.dispatch({ changes: [{ from: open.from, to: open.to }, { from: close.from, to: close.to }] });
    return;
  }
  const { from, to } = state.selection.main;
  view.dispatch({
    changes: [
      { from, insert: mark },
      { from: to, insert: mark },
    ],
    selection: EditorSelection.range(from + mark.length, to + mark.length),
  });
}

// Rewrites the start of every selected line: `strip` matches the prefix to drop, `prefix` gives the one to add (none when null).
function relinePrefix(view: EditorView, strip: RegExp, prefix: ((index: number) => string) | null) {
  const changes: ChangeSpec[] = selectedLines(view.state).map((line, i) => {
    const old = strip.exec(line.text)?.[0] ?? '';
    return { from: line.from, to: line.from + old.length, insert: prefix === null ? '' : prefix(i) };
  });
  view.dispatch({ changes });
}

function toggleHeading(view: EditorView, level: number) {
  const on = headingLevel(view.state.doc.lineAt(view.state.selection.main.head).text) === level;
  relinePrefix(view, HEADING, on ? null : () => `${'#'.repeat(level)} `);
}

function toggleList(view: EditorView, ordered: boolean) {
  const kind = ordered ? ORDERED : BULLET;
  const on = selectedLines(view.state).every((l) => kind.test(l.text));
  relinePrefix(view, LIST, on ? null : (i) => (ordered ? `${i + 1}. ` : '- '));
}

function toggleQuote(view: EditorView) {
  const on = selectedLines(view.state).every((l) => QUOTE.test(l.text));
  relinePrefix(view, QUOTE, on ? null : () => '> ');
}

function toggleCodeBlock(view: EditorView) {
  const state = view.state;
  const block = enclosing(state, 'FencedCode');
  if (block !== null) {
    const open = state.doc.lineAt(block.from);
    const close = state.doc.lineAt(block.to);
    const changes: ChangeSpec[] = [{ from: open.from, to: Math.min(open.to + 1, state.doc.length) }];
    if (close.number !== open.number && close.text.trimStart().startsWith('```')) changes.push({ from: close.from - 1, to: close.to });
    view.dispatch({ changes });
    return;
  }
  const lines = selectedLines(state);
  view.dispatch({
    changes: [
      { from: lines[0]!.from, insert: '```\n' },
      { from: lines[lines.length - 1]!.to, insert: '\n```' },
    ],
  });
}

export function runSourceAction(view: EditorView, action: Exclude<MarkdownAction, 'link' | 'image'>) {
  switch (action) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      toggleInline(view, action);
      break;
    case 'h1':
      toggleHeading(view, 1);
      break;
    case 'h2':
      toggleHeading(view, 2);
      break;
    case 'h3':
      toggleHeading(view, 3);
      break;
    case 'bulletList':
      toggleList(view, false);
      break;
    case 'orderedList':
      toggleList(view, true);
      break;
    case 'blockquote':
      toggleQuote(view);
      break;
    case 'codeBlock':
      toggleCodeBlock(view);
      break;
    case 'undo':
      undo(view);
      break;
    case 'redo':
      redo(view);
      break;
  }
  view.focus();
}

interface LinkParts {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  urlFrom: number;
  urlTo: number;
}

// `[text](url)`: where the text and the URL sit, also for a link whose parentheses are still empty.
function linkParts(state: EditorState): LinkParts | null {
  const link = enclosing(state, 'Link');
  if (link === null) return null;
  const marks: SyntaxNode[] = [];
  let url: SyntaxNode | null = null;
  for (let c = link.firstChild; c !== null; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c);
    if (c.name === 'URL') url = c;
  }
  const [open, close, paren] = marks;
  if (open === undefined || close === undefined || paren === undefined) return null;
  return {
    from: link.from,
    to: link.to,
    textFrom: open.to,
    textTo: close.from,
    urlFrom: url?.from ?? paren.to,
    urlTo: url?.to ?? paren.to,
  };
}

export function linkHref(state: EditorState): string | null {
  const parts = linkParts(state);
  return parts === null ? null : state.sliceDoc(parts.urlFrom, parts.urlTo);
}

export function applySourceLink(view: EditorView, href: string, text: string) {
  const state = view.state;
  const parts = linkParts(state);
  if (parts !== null) {
    view.dispatch({ changes: { from: parts.urlFrom, to: parts.urlTo, insert: href } });
  } else {
    const { from, to, empty } = state.selection.main;
    const insert = empty ? `[${text}](${href})` : `[${state.sliceDoc(from, to)}](${href})`;
    view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length) });
  }
  view.focus();
}

export function removeSourceLink(view: EditorView) {
  const parts = linkParts(view.state);
  if (parts === null) return;
  view.dispatch({ changes: { from: parts.from, to: parts.to, insert: view.state.sliceDoc(parts.textFrom, parts.textTo) } });
  view.focus();
}

// On a line of its own, as the rich editor keeps images; the cursor lands in the brackets, ready for the alt text.
export function insertSourceImage(view: EditorView, assetId: string) {
  const state = view.state;
  const line = state.doc.lineAt(state.selection.main.head);
  const before = line.text.trim() === '' ? '' : '\n\n';
  view.dispatch({
    changes: { from: line.to, insert: `${before}![](/assets/${assetId})` },
    selection: EditorSelection.cursor(line.to + before.length + 2),
  });
  view.focus();
}
