import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('enables confirm only when the typed name matches', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete client"
        message="This cannot be undone."
        expected="Oakwood Strings"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();

    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Type "Oakwood Strings" to confirm'), 'Oakwood Strings');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancels without confirming', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete client"
        message="x"
        expected="X"
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
