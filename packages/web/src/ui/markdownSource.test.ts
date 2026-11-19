import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { activeActions, applySourceLink, historyFlags, insertSourceImage, linkHref, removeSourceLink, runSourceAction } from './markdownSource.js';

// `|` marks the cursor.
function viewOf(text: string): EditorView {
  const cursor = text.indexOf('|');
  const doc = text.replace('|', '');
  const state = EditorState.create({
    doc,
    ...(cursor >= 0 ? { selection: EditorSelection.cursor(cursor) } : {}),
    extensions: [markdown({ base: markdownLanguage }), history()],
  });
  const view = new EditorView({ state, parent: document.body });
  ensureSyntaxTree(view.state, view.state.doc.length);
  return view;
}

function select(view: EditorView, from: number, to: number) {
  view.dispatch({ selection: EditorSelection.range(from, to) });
}

describe('markdown source commands', () => {
  it('wraps a selection in bold and unwraps it again', () => {
    const view = viewOf('say hello');
    select(view, 4, 9);
    runSourceAction(view, 'bold');
    expect(view.state.doc.toString()).toBe('say **hello**');
    expect(activeActions(view.state).bold).toBe(true);
    runSourceAction(view, 'bold');
    expect(view.state.doc.toString()).toBe('say hello');
  });

  it('puts the cursor between the marks when nothing is selected', () => {
    const view = viewOf('x |');
    runSourceAction(view, 'italic');
    expect(view.state.doc.toString()).toBe('x **');
    expect(view.state.selection.main.head).toBe(3);
  });

  it('knows strikethrough and inline code from the syntax tree', () => {
    const view = viewOf('a ~~gone~~ and `code`');
    select(view, 5, 5);
    expect(activeActions(view.state).strike).toBe(true);
    select(view, 17, 17);
    expect(activeActions(view.state).code).toBe(true);
  });

  it('switches heading levels and turns a heading off', () => {
    const view = viewOf('## Title|');
    expect(activeActions(view.state).h2).toBe(true);
    runSourceAction(view, 'h1');
    expect(view.state.doc.toString()).toBe('# Title');
    runSourceAction(view, 'h1');
    expect(view.state.doc.toString()).toBe('Title');
  });

  it('numbers an ordered list over the selected lines and turns a bullet list into it', () => {
    const view = viewOf('- one\n- two');
    select(view, 0, view.state.doc.length);
    runSourceAction(view, 'orderedList');
    expect(view.state.doc.toString()).toBe('1. one\n2. two');
    runSourceAction(view, 'orderedList');
    expect(view.state.doc.toString()).toBe('one\ntwo');
  });

  it('quotes and unquotes lines', () => {
    const view = viewOf('said|');
    runSourceAction(view, 'blockquote');
    expect(view.state.doc.toString()).toBe('> said');
    runSourceAction(view, 'blockquote');
    expect(view.state.doc.toString()).toBe('said');
  });

  it('fences lines as a code block and removes the fences', () => {
    const view = viewOf('let a|');
    runSourceAction(view, 'codeBlock');
    expect(view.state.doc.toString()).toBe('```\nlet a\n```');
    ensureSyntaxTree(view.state, view.state.doc.length);
    select(view, 6, 6);
    expect(activeActions(view.state).codeBlock).toBe(true);
    runSourceAction(view, 'codeBlock');
    expect(view.state.doc.toString()).toBe('let a');
  });

  it('undoes and redoes, and says when it cannot', () => {
    const view = viewOf('x|');
    expect(historyFlags(view.state)).toEqual({ undo: true, redo: true });
    runSourceAction(view, 'h1');
    expect(historyFlags(view.state).undo).toBe(false);
    runSourceAction(view, 'undo');
    expect(view.state.doc.toString()).toBe('x');
    runSourceAction(view, 'redo');
    expect(view.state.doc.toString()).toBe('# x');
  });

  it('links a selection, reads the link back, edits it and removes it', () => {
    const view = viewOf('see docs');
    select(view, 4, 8);
    applySourceLink(view, 'https://a.example', 'unused');
    expect(view.state.doc.toString()).toBe('see [docs](https://a.example)');
    select(view, 6, 6);
    expect(linkHref(view.state)).toBe('https://a.example');
    applySourceLink(view, '/assets/d1', 'unused');
    expect(view.state.doc.toString()).toBe('see [docs](/assets/d1)');
    select(view, 6, 6);
    removeSourceLink(view);
    expect(view.state.doc.toString()).toBe('see docs');
  });

  it('inserts a link with its own text where nothing is selected', () => {
    const view = viewOf('Read |');
    applySourceLink(view, '/assets/d1', 'Proposal');
    expect(view.state.doc.toString()).toBe('Read [Proposal](/assets/d1)');
  });

  it('puts an image on a line of its own, cursor in the alt text', () => {
    const view = viewOf('Intro|');
    insertSourceImage(view, 'a1');
    expect(view.state.doc.toString()).toBe('Intro\n\n![](/assets/a1)');
    expect(view.state.selection.main.head).toBe('Intro\n\n!['.length);
  });
});
