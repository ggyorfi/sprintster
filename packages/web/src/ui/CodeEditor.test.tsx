import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeEditor, codeExtensions } from './CodeEditor.js';

describe('codeExtensions', () => {
  it('returns a language extension for each known language', () => {
    for (const lang of ['markdown', 'html', 'css', 'json']) {
      expect(codeExtensions(lang).length).toBeGreaterThan(0);
    }
  });

  it('returns no extension for plaintext, undefined, or an unknown language', () => {
    expect(codeExtensions('plaintext')).toEqual([]);
    expect(codeExtensions(undefined)).toEqual([]);
    expect(codeExtensions('brainfuck')).toEqual([]);
  });
});

describe('CodeEditor', () => {
  it('renders its label and a CodeMirror editor showing the initial value', () => {
    const { container } = render(<CodeEditor label="Snippet" value="hello world" onChange={() => {}} />);
    expect(screen.getByText('Snippet')).toBeInTheDocument();
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.cm-content')?.textContent).toContain('hello world');
  });
});
