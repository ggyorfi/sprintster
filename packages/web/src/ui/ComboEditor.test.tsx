import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComboEditor } from './ComboEditor.js';

describe('ComboEditor', () => {
  it('opens in the rich (wysiwyg) editor by default', () => {
    const { container } = render(<ComboEditor label="Body" value={'# Hi'} onChange={() => {}} />);
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(container.querySelector('.ProseMirror')).not.toBeNull();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });

  it('toggles to source and back over the same value', async () => {
    const { container } = render(<ComboEditor value={'# Hi'} onChange={() => {}} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.ProseMirror')).toBeNull();
    expect(container.querySelector('.cm-content')?.textContent).toContain('# Hi');
    await userEvent.click(screen.getByRole('tab', { name: 'Rich' }));
    expect(container.querySelector('.ProseMirror')).not.toBeNull();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });

  it('respects defaultMode=source', () => {
    const { container } = render(<ComboEditor value={'x'} onChange={() => {}} defaultMode="source" />);
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });
});
