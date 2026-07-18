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
