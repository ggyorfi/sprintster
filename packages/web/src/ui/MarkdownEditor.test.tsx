import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditor } from './MarkdownEditor.js';

describe('MarkdownEditor', () => {
  it('renders markdown formatted in place', () => {
    const { container } = render(
      <MarkdownEditor label="Body" value={'# Title\n\nHello **world**'} onChange={() => {}} />,
    );
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(container.querySelector('h1')?.textContent).toContain('Title');
    expect(container.querySelector('strong')?.textContent).toContain('world');
  });

  it('shows a formatting toolbar whose buttons reflect the active mark', async () => {
    render(<MarkdownEditor label="Body" value={'hello'} onChange={() => {}} />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));
  });

  it('is not editable in read-only mode and hides the toolbar (preview reuse)', () => {
    const { container } = render(<MarkdownEditor value={'plain text'} onChange={() => {}} readOnly />);
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  });
});
