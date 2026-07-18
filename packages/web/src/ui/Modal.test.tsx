import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal.js';

describe('Modal', () => {
  it('renders title and content in a dialog', () => {
    render(
      <Modal title="Edit client" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Edit client' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('closes on the close button and on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal title="Edit client" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
