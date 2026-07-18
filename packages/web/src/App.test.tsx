import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './app/App.js';
import { setAppConfig, fixtureRefConfig } from '@sprintster/engine';

setAppConfig(fixtureRefConfig);

describe('App shell', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one nav item per configured object plus Maintenance', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Clients' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Memos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maintenance' })).toBeInTheDocument();
  });
});
