import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { fixtureAppRaw, loadConfig, setAppConfig, type ApiClient, type ListParams } from '@sprintster/engine';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('App: list filters (ADR 27)', () => {
  it('cycles the first filter group with f, asking the daemon for the chosen option', async () => {
    const config = loadConfig({
      ...fixtureAppRaw,
      objects: fixtureAppRaw.objects.map((o: { name: string; lists?: unknown[] }) =>
        o.name === 'client'
          ? { ...o, lists: [{ ...(o.lists as Array<Record<string, unknown>>)[0], filters: [{ label: 'Service', options: [{ label: 'Students', property: 'service', equals: 'student' }, { label: 'Others', property: 'service', notEquals: 'student' }] }] }] }
          : o,
      ),
    });
    setAppConfig(config);
    const calls: ListParams[] = [];
    const page = async (p: ListParams) => {
      calls.push(p);
      return { rows: [{ id: 'c1', name: 'Ann Lee', service: 'student', rate: '100', paymentTermsDays: 7, removed: false }], total: 1, next: null };
    };
    const api = { object: () => ({ page, get: async () => null, list: async () => [] }) } as unknown as ApiClient;
    const { lastFrame, stdin } = render(<App apiClient={api} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Ann Lee'));
    expect(strip(lastFrame() ?? '')).toContain('f service: All');
    stdin.write('f');
    await waitFor(() => calls.at(-1)?.filter?.[0] === 'Service:Students');
    stdin.write('f');
    await waitFor(() => calls.at(-1)?.filter?.[0] === 'Service:Others');
    await waitFor(() => strip(lastFrame() ?? '').includes('f service: Others'));
    stdin.write('f');
    await waitFor(() => calls.at(-1)?.filter === undefined && calls.length >= 4);
  });
});
