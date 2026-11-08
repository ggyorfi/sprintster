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

describe('RepeatingGroup with column choices', () => {
  const props = [{ name: 'size', title: 'Size', type: 'text' }] as unknown as PropertyConfig[];
  function ChoicesHarness({ initial }: { initial: Record<string, string> }) {
    const [inputs, setInputs] = useState(initial);
    return <RepeatingGroup label="Stock" path="rows" itemProperties={props} inputs={inputs} setInputs={setInputs} layout="table" columnChoices={{ size: ['S', 'M'] }} />;
  }

  it('offers the choices as a select and keeps a saved value that left the list', () => {
    render(<ChoicesHarness initial={{ 'rows.0.size': 'XL' }} />);
    const select = screen.getByRole('combobox', { name: 'Size 1' });
    expect(select).toHaveValue('XL');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['', 'XL', 'S', 'M']);
  });
});

describe('RepeatingGroup column labels and visibility', () => {
  const props = [
    { name: 'a', title: 'A', type: 'text' },
    { name: 'b', title: 'B', type: 'text' },
    { name: 'c', title: 'C', type: 'text' },
    { name: 'stock', title: 'Stock', type: 'integer' },
  ] as unknown as PropertyConfig[];

  it('titles columns from labels, hides empty ones and unmet conditions, keeps their values', () => {
    const inputs = { mode: 'off', 'rows.0.a': 'M', 'rows.0.b': 'x', 'rows.0.c': 'y', 'rows.0.stock': '1' };
    render(
      <RepeatingGroup
        label="Stock"
        path="rows"
        itemProperties={props}
        inputs={inputs}
        setInputs={() => {}}
        layout="table"
        columnLabels={{ a: 'Size', b: '', c: 'Stone' }}
        columnVisibleWhen={{ c: { property: 'mode', notEquals: 'off' } }}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Size', 'Stock', '']);
    expect(screen.getByLabelText('Size 1')).toHaveValue('M');
  });
});

describe('RepeatingGroup read only', () => {
  const props = [
    { name: 'product', title: 'Product', type: 'ref', target: 'p' },
    { name: 'title', title: 'Title', type: 'text' },
    { name: 'qty', title: 'Qty', type: 'integer' },
  ] as unknown as PropertyConfig[];

  it('shows values in a table without controls or raw references', () => {
    render(<RepeatingGroup label="Items" path="rows" itemProperties={props} inputs={{ 'rows.0.product': 'uuid-1', 'rows.0.title': 'Ring', 'rows.0.qty': '2' }} setInputs={() => {}} readOnly />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Title', 'Qty']);
    expect(screen.getByText('Ring')).toBeInTheDocument();
    expect(screen.queryByText('uuid-1')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
