import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { loadConfig, setAppConfig, type ApiClient } from '@sprintster/engine';
import { refreshTheme } from './theme.js';

setAppConfig(
  loadConfig({
    version: '1',
    objects: [
      {
        name: 'settings',
        title: 'Site Setting',
        titlePlural: 'Site Settings',
        singleton: true,
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'siteTitle', type: 'text', title: 'Site title', default: 'My site' },
          { name: 'baseUrl', type: 'text', title: 'Base URL' },
        ],
        lists: [],
        views: [
          { name: 'default', title: 'Settings', fields: [{ property: 'siteTitle' }, { property: 'baseUrl' }] },
        ],
      },
    ],
  }),
);
refreshTheme();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');

const record = { id: 'settings', siteTitle: 'My site', baseUrl: '' };

function mockApi(over: Record<string, unknown> = {}): ApiClient {
  const obj = {
    list: async () => [record],
    get: async () => record,
    refresh: async () => record,
    status: async () => null,
    ...over,
  };
  return { object: () => obj } as unknown as ApiClient;
}

async function waitFor(check: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('App: singleton objects', () => {
  it('opens the form directly, without the user pressing anything', async () => {
    const { lastFrame } = render(<App apiClient={mockApi()} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Site title'));

    const frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Site title');
    expect(frame).toContain('My site');
  });

  it('opens in edit mode, which is what routes a save to update rather than add', async () => {
    const { lastFrame } = render(<App apiClient={mockApi()} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Site title'));

    expect(strip(lastFrame() ?? '')).toContain('Edit settings');
  });

  it('shows the projected zero value for an unsaved field', async () => {
    const { lastFrame } = render(<App apiClient={mockApi()} daemonUrl="http://x" />);
    await waitFor(() => strip(lastFrame() ?? '').includes('Site title'));

    expect(strip(lastFrame() ?? '')).toContain('Base URL');
  });
});
