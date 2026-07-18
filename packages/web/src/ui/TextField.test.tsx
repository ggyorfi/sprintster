import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from './TextField.js';

describe('TextField', () => {
  it('associates the label with the input and shows the value', () => {
    render(<TextField label="Name" value="Oakwood Strings" onChange={() => {}} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Oakwood Strings');
  });

  it('emits the new value string on change', async () => {
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Name'), 'H');
    expect(onChange).toHaveBeenCalledWith('H');
  });

  it('marks invalid and shows the error message', () => {
    render(<TextField label="Name" value="" error="Name is required" />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  });

  it('renders read-only when requested', () => {
    render(<TextField label="No." value="#1042" readOnly />);
    expect(screen.getByLabelText('No.')).toHaveAttribute('readonly');
  });

  it('renders a textarea when multiline', () => {
    render(<TextField label="Notes" value="hi" multiline rows={3} onChange={() => {}} />);
    const el = screen.getByLabelText('Notes');
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('renders a prefix adornment', () => {
    render(<TextField label="Rate" prefix="£" value="50" onChange={() => {}} />);
    expect(screen.getByText('£')).toBeInTheDocument();
  });
});
