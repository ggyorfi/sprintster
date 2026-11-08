import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordTimes } from './ObjectForm.js';

describe('RecordTimes', () => {
  it('shows created and updated as local date and time', () => {
    render(<RecordTimes row={{ id: 'x', createdAt: '2025-07-25T13:36:00Z', updatedAt: '2026-11-07T09:00:00Z' }} />);
    expect(screen.getByText(/^Created \d{4}-\d\d-\d\d \d\d:\d\d – Updated 2026-11-0\d \d\d:\d\d$/)).toBeInTheDocument();
  });

  it('shows both even when the record never changed, and nothing before its first save', () => {
    const { container, rerender } = render(<RecordTimes row={{ id: 'x', createdAt: '2025-07-25T13:36:00Z', updatedAt: '2025-07-25T13:36:00Z' }} />);
    expect(screen.getByText(/ – Updated /)).toBeInTheDocument();
    rerender(<RecordTimes row={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
