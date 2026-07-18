import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefPicker } from './RefPicker.js';

const options = [
  { value: 't1', label: 'Alfie Granger' },
  { value: 't2', label: 'Thomas Lam' },
  { value: 't3', label: 'Mira Chen' },
];

describe('RefPicker (single)', () => {
  it('shows the selected option as a chip', () => {
    render(<RefPicker label="Client" value="t2" options={options} onChange={() => {}} />);
    expect(screen.getByText('Thomas Lam')).toBeInTheDocument();
  });

  it('filters options as you type and emits the clicked id', async () => {
    const onChange = vi.fn();
    render(<RefPicker label="Client" value="" options={options} onChange={onChange} />);
    const box = screen.getByRole('searchbox');
    await userEvent.click(box);
    await userEvent.type(box, 'mc');
    expect(screen.getByRole('option', { name: 'Mira Chen' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Thomas Lam' })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Mira Chen' }));
    expect(onChange).toHaveBeenCalledWith('t3');
  });

  it('clears the value when the chip is removed', async () => {
    const onChange = vi.fn();
    render(<RefPicker label="Client" value="t2" options={options} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Thomas Lam' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('highlights matched characters', async () => {
    const { container } = render(<RefPicker label="Client" value="" options={options} onChange={() => {}} />);
    const box = screen.getByRole('searchbox');
    await userEvent.click(box);
    await userEvent.type(box, 'al');
    expect(container.querySelector('mark')).not.toBeNull();
  });
});

describe('RefPicker (multiple)', () => {
  it('renders a chip per selected id from a JSON value', () => {
    render(<RefPicker label="Tags" multiple value='["t1","t3"]' options={options} onChange={() => {}} />);
    expect(screen.getByText('Alfie Granger')).toBeInTheDocument();
    expect(screen.getByText('Mira Chen')).toBeInTheDocument();
  });

  it('appends a selected id, preserving order', async () => {
    const onChange = vi.fn();
    render(<RefPicker label="Tags" multiple value='["t1"]' options={options} onChange={onChange} />);
    const box = screen.getByRole('searchbox');
    await userEvent.click(box);
    await userEvent.type(box, 'lam');
    await userEvent.click(screen.getByRole('option', { name: 'Thomas Lam' }));
    expect(onChange).toHaveBeenCalledWith('["t1","t2"]');
  });

  it('hides already-selected options from the list', async () => {
    render(<RefPicker label="Tags" multiple value='["t1"]' options={options} onChange={() => {}} />);
    const box = screen.getByRole('searchbox');
    await userEvent.click(box);
    await userEvent.type(box, 'a');
    expect(screen.queryByRole('option', { name: 'Alfie Granger' })).toBeNull();
  });

  it('removes a chip, emitting JSON without that id', async () => {
    const onChange = vi.fn();
    render(<RefPicker label="Tags" multiple value='["t1","t2"]' options={options} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Alfie Granger' }));
    expect(onChange).toHaveBeenCalledWith('["t2"]');
  });
});
