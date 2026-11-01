import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Extensions } from './Extensions.js';

const extensions = {
  actions: [{ id: 'pub.publish', label: 'Publish', route: '/plugins/pub/requests' }],
  badges: [{ id: 'pub.changes', route: '/plugins/pub/status' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('Extensions', () => {
  it('shows the badge, runs the action, shows its reply and reloads the badge', async () => {
    let changes = 3;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        changes = 0;
        return Response.json({ message: 'Publishing started.' });
      }
      return Response.json({ text: `${changes} unpublished changes`, tone: changes > 0 ? 'warning' : 'success' });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Extensions baseUrl="/api" extensions={extensions} />);
    expect(await screen.findByText('3 unpublished changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/plugins/pub/requests', { method: 'POST' });
    expect(await screen.findByText('Publishing started.')).toBeInTheDocument();
    expect(await screen.findByText('0 unpublished changes')).toBeInTheDocument();
  });

  it('renders nothing without extensions', () => {
    const { container } = render(<Extensions baseUrl="" extensions={{ actions: [], badges: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
