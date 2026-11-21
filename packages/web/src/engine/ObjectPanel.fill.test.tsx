import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appConfig, loadConfig, setAppConfig, type ApiClient, type Config } from '@sprintster/engine';
import { ObjectPanel } from './ObjectPanel.js';
import { makeResolveObject, type Row } from './resolve.js';

const config = loadConfig({
  version: '1',
  locales: ['hu', 'en'],
  objects: [
    {
      name: 'article',
      title: 'Article',
      titlePlural: 'Articles',
      route: 'articles',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'title', type: 'text', translated: true },
        { name: 'slug', type: 'text', validation: { required: true, maxLength: 20, unique: true } },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Articles', columns: [{ property: 'title' }] }],
      views: [{ name: 'default', title: 'Article', fields: [{ property: 'title' }, { property: 'slug', fillFrom: 'title' }] }],
    },
  ],
});

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

function open(row: Row | null, freeValue: (field: string, value: string, id?: string) => Promise<string>) {
  const api = { object: () => ({ list: async () => [], get: async () => null, freeValue }) } as unknown as ApiClient;
  render(
    <ObjectPanel
      api={api}
      obj={config.objects[0]!}
      resolveObject={makeResolveObject(config.objects)}
      initialMode={row === null ? 'create' : 'edit'}
      row={row}
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
}

describe('fillFrom', () => {
  it('fills the empty slug when the title loses focus, with the free value the server answers', async () => {
    const freeValue = vi.fn(async (_field: string, value: string) => `${value}-2`);
    open(null, freeValue);
    await userEvent.type(screen.getByLabelText('title'), 'Esemény utáni tabletták');
    await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText('slug')).toHaveValue('esemeny-utani-tablet-2'));
    expect(freeValue).toHaveBeenCalledWith('slug', 'esemeny-utani-tablet', undefined);
  });

  it('leaves a slug alone once it has one, and names the record being edited', async () => {
    const freeValue = vi.fn(async (_field: string, value: string) => value);
    open({ id: 'a1', title: { hu: 'Régi' }, slug: 'kezzel', removed: false }, freeValue);
    await userEvent.type(screen.getByLabelText('title'), ' új');
    await userEvent.tab();
    expect(freeValue).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('slug'));
    await userEvent.click(screen.getByLabelText('title'));
    await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText('slug')).toHaveValue('regi-uj'));
    expect(freeValue).toHaveBeenCalledWith('slug', 'regi-uj', 'a1');
  });
});
