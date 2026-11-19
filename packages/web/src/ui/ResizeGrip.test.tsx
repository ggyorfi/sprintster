import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditor } from './MarkdownEditor.js';
import { ComboEditor } from './ComboEditor.js';

const LAZY = { timeout: 5000 };

describe('editor resize grip', () => {
  it('resizes the rich editor by keyboard, never below the minimum', () => {
    render(<MarkdownEditor value={'hi'} onChange={() => {}} />);
    const grip = screen.getByRole('separator', { name: 'Resize editor' });
    const frame = grip.parentElement!;
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(grip.parentElement!.style.getPropertyValue('--editor-height')).toBe('90px');
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    expect(frame.style.getPropertyValue('--editor-height')).toBe('66px');
  });

  it('drags to a new height', () => {
    render(<MarkdownEditor value={'hi'} onChange={() => {}} />);
    const grip = screen.getByRole('separator', { name: 'Resize editor' });
    fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 500, pointerId: 1 });
    expect(grip.parentElement!.style.getPropertyValue('--editor-height')).toBe('266px');
  });

  it('keeps one height across rich and source in a combo', async () => {
    const { container } = render(<ComboEditor value={'hi'} onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull(), LAZY);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    await userEvent.click(screen.getByRole('tab', { name: 'Source' }));
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull(), LAZY);
    expect(screen.getByRole('separator').parentElement!.style.getPropertyValue('--editor-height')).toBe('90px');
  });
});
