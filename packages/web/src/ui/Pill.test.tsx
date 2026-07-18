import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill.js';

describe('Pill', () => {
  it('renders its content and carries the tone', () => {
    render(<Pill tone="success">paid</Pill>);
    const pill = screen.getByText('paid');
    expect(pill).toHaveAttribute('data-tone', 'success');
  });
});
