import { useState } from 'react';
import { Modal } from './Modal.js';
import { Button, type ButtonVariant } from './Button.js';
import { TextField } from './TextField.js';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  expected: string;
  confirmLabel: string;
  tone?: ButtonVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  expected,
  confirmLabel,
  tone = 'destructive',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const matches = typed === expected;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="neutral" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone} disabled={!matches} onClick={() => matches && onConfirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
      <TextField label={`Type "${expected}" to confirm`} value={typed} onChange={setTyped} />
    </Modal>
  );
}
