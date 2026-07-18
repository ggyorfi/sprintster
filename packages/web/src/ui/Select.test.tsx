import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from './Select.js';

const options = [
  { value: 'student', label: 'student' },
  { value: 'accompaniment', label: 'accompaniment' },
];

describe('Select', () => {
  it('renders options and reflects the current value', () => {
    render(<Select label="Service" value="accompaniment" options={options} onChange={() => {}} />);
    expect(screen.getByLabelText('Service')).toHaveValue('accompaniment');
  });

  it('emits the chosen value', async () => {
    const onChange = vi.fn();
    render(<Select label="Service" value="student" options={options} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Service'), 'accompaniment');
    expect(onChange).toHaveBeenCalledWith('accompaniment');
  });
});
