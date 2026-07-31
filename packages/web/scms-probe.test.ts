import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

const make = (element: HTMLElement | null) =>
  new Editor({ extensions: [StarterKit, Markdown], content: 'hi', contentType: 'markdown', element });

type Probe = Record<string, () => unknown>;

function surface(editor: Editor): Probe {
  const e = editor as unknown as { getMarkdown: () => string };
  return {
    'view.dom': () => editor.view.dom,
    commands: () => editor.commands,
    'chain()': () => editor.chain(),
    'can()': () => editor.can(),
    'commands.setContent': () => editor.commands.setContent('x', { contentType: 'markdown', emitUpdate: false }),
    getMarkdown: () => e.getMarkdown(),
    isActive: () => editor.isActive('image'),
    getAttributes: () => editor.getAttributes('image'),
    setEditable: () => editor.setEditable(false),
  };
}

function report(label: string, editor: Editor): void {
  const rows = Object.entries(surface(editor)).map(([name, run]) => {
    try {
      run();
      return `  ok     ${name}`;
    } catch (error) {
      return `  THROWS ${name}  -> ${String(error).split('\n')[0]!.slice(0, 72)}`;
    }
  });
  console.log(`\n${label}  (isDestroyed=${editor.isDestroyed})\n${rows.join('\n')}`);
}

describe('the two states in which isDestroyed is true', () => {
  it('maps the broken surface of each state', () => {
    report('A: view never attached', make(null));

    const dead = make(document.createElement('div'));
    expect(dead.isDestroyed).toBe(false);
    dead.destroy();
    report('B: after destroy()', dead);
  });
});
