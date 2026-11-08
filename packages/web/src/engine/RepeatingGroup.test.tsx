import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropertyConfig } from '@sprintster/engine';
import { RepeatingGroup } from './RepeatingGroup.js';

const itemProps = [
  { name: 'value', title: 'Email', type: 'text' },
  { name: 'label', title: 'Label', type: 'text', nullable: true },
] as unknown as PropertyConfig[];

function Harness({ initial }: { initial: Record<string, string> }) {
  const [inputs, setInputs] = useState(initial);
  return (
    <>
      <RepeatingGroup label="Emails" path="emails" itemProperties={itemProps} inputs={inputs} setInputs={setInputs} />
      <pre data-testid="dump">{JSON.stringify(inputs)}</pre>
    </>
  );
}

describe('RepeatingGroup', () => {
  it('seeds items from indexed inputs', () => {
    render(<Harness initial={{ 'emails.0.value': 'a@b.com', 'emails.0.label': 'work' }} />);
    expect(screen.getByLabelText('Email')).toHaveValue('a@b.com');
  });

  it('adds an item, edits it, and removes with reindexing', async () => {
    render(<Harness initial={{ 'emails.0.value': 'a@b.com', 'emails.0.label': 'work' }} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add another' }));
    const emails = screen.getAllByLabelText('Email');
    expect(emails).toHaveLength(2);

    await userEvent.type(emails[1]!, 'c@d.com');
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

    const dump = JSON.parse(screen.getByTestId('dump').textContent ?? '{}') as Record<string, string>;
    expect(dump['emails.0.value']).toBe('c@d.com');
    expect(dump['emails.1.value']).toBeUndefined();
  });
});

describe('RepeatingGroup as a table', () => {
  const sizeProps = [
    { name: 'size', title: 'Size', type: 'enum', values: ['L', 'M', 'N'] },
    { name: 'stock', title: 'Stock', type: 'integer', default: 0 },
  ] as unknown as PropertyConfig[];

  function TableHarness({ initial }: { initial: Record<string, string> }) {
    const [inputs, setInputs] = useState(initial);
    return (
      <>
        <RepeatingGroup label="Stock by size" path="rows" itemProperties={sizeProps} inputs={inputs} setInputs={setInputs} layout="table" />
        <pre data-testid="dump">{JSON.stringify(inputs)}</pre>
      </>
    );
  }

  it('shows one row per item, an enum as a select, and adds rows with defaults', async () => {
    render(<TableHarness initial={{ 'rows.0.size': 'M', 'rows.0.stock': '2' }} />);
    expect(screen.getByRole('columnheader', { name: 'Size' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Size 1' })).toHaveValue('M');
    await userEvent.click(screen.getByRole('button', { name: 'Add row' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Size 2' }), 'N');
    expect(JSON.parse(screen.getByTestId('dump').textContent!)).toMatchObject({ 'rows.1.size': 'N', 'rows.1.stock': '0' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
    expect(JSON.parse(screen.getByTestId('dump').textContent!)).toEqual({ 'rows.0.size': 'N', 'rows.0.stock': '0' });
  });
});
