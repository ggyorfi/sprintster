import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Table, type Column } from './Table.js';

const columns: Column[] = [
  { key: 'name', label: 'Name', width: 30 },
  { key: 'service', label: 'Service' },
  { key: 'terms', label: 'Terms', suffix: 'd' },
];

const rows = [
  { id: 'a1', name: 'Oakwood Strings', service: 'student', terms: 7 },
  { id: 'b2', name: 'Harriet Bowen', service: 'accompaniment', terms: 14 },
];

describe('Table', () => {
  it('renders column headers and cell values', () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByText('Oakwood Strings')).toBeInTheDocument();
  });

  it('appends a column suffix to the value', () => {
    render(<Table columns={columns} rows={rows} />);
    const firstBody = screen.getAllByRole('row')[1]!;
    expect(within(firstBody).getByText('7')).toBeInTheDocument();
    expect(within(firstBody).getByText('d')).toBeInTheDocument();
  });

  it('calls onSelect with the row id on click', async () => {
    const onSelect = vi.fn();
    render(<Table columns={columns} rows={rows} onSelect={onSelect} />);
    await userEvent.click(screen.getByText('Harriet Bowen'));
    expect(onSelect).toHaveBeenCalledWith('b2');
  });

  it('marks the selected row with aria-selected', () => {
    render(<Table columns={columns} rows={rows} selectedId="a1" />);
    const selected = screen.getAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true');
    expect(selected).toBeDefined();
    expect(within(selected!).getByText('Oakwood Strings')).toBeInTheDocument();
  });

  it('shows an empty label when there are no rows', () => {
    render(<Table columns={columns} rows={[]} emptyLabel="No clients yet" />);
    expect(screen.getByText('No clients yet')).toBeInTheDocument();
  });

  it('renders a per-row edit action that calls onEdit with the row id', async () => {
    const onEdit = vi.fn();
    render(<Table columns={columns} rows={rows} onEdit={onEdit} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    expect(onEdit).toHaveBeenCalledWith('b2');
  });
});
