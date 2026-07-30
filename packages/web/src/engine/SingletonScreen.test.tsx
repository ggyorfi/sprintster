import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadConfig, type ApiClient, type ObjectConfig } from '@sprintster/engine';
import { ObjectScreen } from './ObjectScreen.js';
import type { Row } from './resolve.js';

const settings: ObjectConfig = loadConfig({
  version: '1',
  objects: [
    {
      name: 'settings',
      title: 'Site Setting',
      titlePlural: 'Site Settings',
      route: 'site-settings',
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
}).objects[0]!;

const resolveObject = (name: string): ObjectConfig | undefined => (name === 'settings' ? settings : undefined);

function makeApi(row: Row, update: ReturnType<typeof vi.fn>): ApiClient {
  return {
    object: () => ({
      list: async () => [row],
      get: async () => row,
      update,
      add: vi.fn(),
      remove: vi.fn(),
      transition: vi.fn(),
      status: async () => null,
      sync: async () => ({}),
      refresh: async () => row,
    }),
  } as unknown as ApiClient;
}

const row: Row = { id: 'settings', siteTitle: 'My site', baseUrl: '' };

describe('ObjectScreen for a singleton', () => {
  it('renders the form directly, with no table and no create button', async () => {
    render(<ObjectScreen api={makeApi(row, vi.fn())} obj={settings} resolveObject={resolveObject} />);

    expect(await screen.findByLabelText('Site title')).toHaveValue('My site');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New/i })).not.toBeInTheDocument();
  });

  it('saves edits without needing an id from the user', async () => {
    const update = vi.fn(async (_id: string, _input: unknown) => row);
    render(<ObjectScreen api={makeApi(row, update)} obj={settings} resolveObject={resolveObject} />);

    const field = await screen.findByLabelText('Base URL');
    await userEvent.type(field, 'https://example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toMatchObject({ baseUrl: 'https://example.com' });
  });
});
