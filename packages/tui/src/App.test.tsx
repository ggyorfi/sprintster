import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import type { ApiClient } from '@sprintster/engine';
import { fixtureConfig, setAppConfig } from '@sprintster/engine';
import { refreshTheme } from './theme.js';

type Client = {
  id: string;
  name: string;
  service: string;
  rate: string;
  paymentTermsDays: number;
  address: null;
  notes: string | null;
  removed: boolean;
};

setAppConfig(fixtureConfig);
refreshTheme();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');

function makeClients(n: number): Client[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(2, '0')}-0000-4000-8000-000000000000`,
    name: `Client${String(i).padStart(2, '0')}`,
    service: 'student' as const,
    rate: '5000',
    paymentTermsDays: 7,
    address: null,
    notes: null,
    removed: false,
  }));
}

function namedClients(names: string[]): Client[] {
  return names.map((name, i) => ({
    id: `id-${String(i).padStart(2, '0')}-0000-4000-8000-000000000000`,
    name,
    service: 'student' as const,
    rate: '5000',
    paymentTermsDays: 7,
    address: null,
    notes: null,
    removed: false,
  }));
}

function mockApi(clients: Client[], over: Record<string, unknown> = {}): ApiClient {
  const obj = { list: async () => clients, ...over };
  return { object: () => obj } as unknown as ApiClient;
}

async function waitFor(check: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('App: long client list', () => {
  it('windows the list instead of rendering all rows (no terminal overflow)', async () => {
    const { lastFrame } = render(<App apiClient={mockApi(makeClients(100))} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Client00'));

    const frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Client00');
    expect(frame).not.toContain('Client99'); // off-screen rows are not rendered
    expect((lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(30); // fits the terminal
    expect(frame).toContain('1/100'); // footer position counter
  });

  it('jumps to the bottom on G and steps back with k, updating the counter', async () => {
    const { lastFrame, stdin } = render(<App apiClient={mockApi(makeClients(100))} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Client00'));

    stdin.write('G');
    await waitFor(() => strip(lastFrame() ?? '').includes('100/100'));
    expect(strip(lastFrame() ?? '')).toContain('Client99');

    stdin.write('k');
    await waitFor(() => strip(lastFrame() ?? '').includes('99/100'));
  });
});

describe('App: action keys ignore the ctrl modifier', () => {
  it('Ctrl-d does not delete; plain d confirms and y deletes', async () => {
    const remove = vi.fn(async () => makeClients(1)[0]);
    const { stdin } = render(<App apiClient={mockApi(makeClients(100), { remove })} daemonUrl="http://x" />);
    await new Promise((r) => setTimeout(r, 80)); // let the initial list load

    stdin.write(''); // Ctrl-d (EOF) must not delete
    await new Promise((r) => setTimeout(r, 40));
    expect(remove).not.toHaveBeenCalled();

    stdin.write('d'); // plain d opens the confirmation, does not delete yet
    await new Promise((r) => setTimeout(r, 40));
    expect(remove).not.toHaveBeenCalled();

    stdin.write('y'); // confirm
    await waitFor(() => remove.mock.calls.length > 0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a delete confirmation can be cancelled with n', async () => {
    const remove = vi.fn(async () => makeClients(1)[0]);
    const { stdin } = render(<App apiClient={mockApi(makeClients(100), { remove })} daemonUrl="http://x" />);
    await new Promise((r) => setTimeout(r, 80));

    stdin.write('d');
    await new Promise((r) => setTimeout(r, 40));
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 40));
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('App: client search', () => {
  const clients = namedClients(['Thomas Lam', 'Alfie Granger', 'Belsize Synagogue']);

  it('filters live as you type, keeps the filter on Enter, and clears on Esc', async () => {
    const { lastFrame, stdin } = render(<App apiClient={mockApi(clients)} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Thomas Lam'));

    stdin.write('/');
    await waitFor(() => strip(lastFrame() ?? '').includes('Search:'));
    stdin.write('lam');
    await waitFor(() => strip(lastFrame() ?? '').includes('Search: lam'));

    let frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Thomas Lam');
    expect(frame).not.toContain('Alfie Granger');
    expect(frame).not.toContain('Belsize');
    expect(frame).toContain('1/1');

    // Enter applies: search prompt gone, filter still active
    stdin.write('\r');
    await waitFor(() => !strip(lastFrame() ?? '').includes('Search: lam'));
    frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Thomas Lam');
    expect(frame).not.toContain('Alfie Granger');
    expect(frame).toContain('Esc clear');

    // Esc clears the filter: full list returns
    stdin.write('');
    await waitFor(() => strip(lastFrame() ?? '').includes('Alfie Granger'));
    frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Thomas Lam');
    expect(frame).toContain('Belsize Synagogue');
  });

  it('shows a zero-match state', async () => {
    const { lastFrame, stdin } = render(<App apiClient={mockApi(clients)} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Thomas Lam'));

    stdin.write('/');
    await waitFor(() => strip(lastFrame() ?? '').includes('Search:'));
    stdin.write('zzz');
    await waitFor(() => strip(lastFrame() ?? '').includes('0 matches'));
    const frame = strip(lastFrame() ?? '');
    expect(frame).not.toContain('Thomas Lam');
    expect(frame).not.toContain('Alfie Granger');
  });
});
