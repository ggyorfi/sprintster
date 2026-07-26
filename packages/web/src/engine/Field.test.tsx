import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PropertyConfig, ViewFieldSpec } from '@sprintster/engine';
import { Field } from './Field.js';

function specFor(property: PropertyConfig): ViewFieldSpec {
  return {
    path: property.name,
    property,
    label: 'Published at',
    placeholder: '',
    rows: 1,
    group: null,
    editable: true,
    derivedFromRef: null,
    defaultInput: '',
  };
}

const datetime = { name: 'publishedAt', type: 'datetime', nullable: true } as PropertyConfig;

describe('Field: datetime', () => {
  it('renders a datetime-local control, not a plain text input', () => {
    render(<Field spec={specFor(datetime)} value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Published at')).toHaveAttribute('type', 'datetime-local');
  });

  it('accepts seconds so a stored instant round-trips unshifted', () => {
    render(<Field spec={specFor(datetime)} value="2026-07-25T14:30:45" onChange={() => {}} />);
    const input = screen.getByLabelText('Published at') as HTMLInputElement;
    expect(input).toHaveAttribute('step', '1');
    expect(new Date(input.value).getTime()).toBe(new Date('2026-07-25T14:30:45').getTime());
  });
});
