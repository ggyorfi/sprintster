import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './App.js';
import { loadConfig, setAppConfig, type ApiClient } from '@sprintster/engine';
import { refreshTheme } from './theme.js';

setAppConfig(
  loadConfig({
    version: '1',
    locales: ['en', 'hu'],
    objects: [
      {
        name: 'settings',
        title: 'Site Setting',
        titlePlural: 'Site Settings',
        route: 'site-settings',
        singleton: true,
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'tagline', type: 'text', title: 'Tagline', translated: true },
        ],
        lists: [],
        views: [{ name: 'default', title: 'Settings', fields: [{ property: 'tagline' }] }],
      },
    ],
  }),
);
refreshTheme();

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replace(ANSI, '');
const record = { id: 'settings', tagline: { en: 'Paintings', hu: 'Festmények' } };
const api = { object: () => ({ list: async () => [record], refresh: async () => record, status: async () => null }) } as unknown as ApiClient;

describe('App: translated fields', () => {
  it('shows one row per locale with its own value', async () => {
    const { lastFrame } = render(<App apiClient={api} daemonUrl="http://x" />);
    const start = Date.now();
    while (!strip(lastFrame() ?? '').includes('Tagline (hu)')) {
      if (Date.now() - start > 1500) throw new Error('form did not open');
      await new Promise((r) => setTimeout(r, 10));
    }
    const frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Tagline (en)');
    expect(frame).toContain('Paintings');
    expect(frame).toContain('Festmények');
  });
});
