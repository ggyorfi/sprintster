import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appConfig, loadConfig, setAppConfig, type ApiClient, type Config } from '@sprintster/engine';
import { ObjectPanel } from './ObjectPanel.js';
import { makeResolveObject, type Row } from './resolve.js';

const config = loadConfig({
  version: '1',
  locales: ['en', 'hu'],
  objects: [
    {
      name: 'work',
      title: 'Work',
      titlePlural: 'Works',
      route: 'works',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'title', title: 'Title', type: 'text', translated: true },
        { name: 'slug', title: 'Slug', type: 'text' },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Works', columns: [{ property: 'title' }] }],
      views: [{ name: 'default', title: 'Work', fields: [{ property: 'title' }, { property: 'slug' }] }],
    },
  ],
});

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

function makeApi(update: ReturnType<typeof vi.fn>): ApiClient {
  return { object: () => ({ list: async () => [], add: vi.fn(), update }) } as unknown as ApiClient;
}

describe('translated fields', () => {
  it('edits one language at a time, keeping the others', async () => {
    const update = vi.fn(async () => ({}));
    const row: Row = { id: 'w1', title: { en: 'Mask' }, slug: 'mask', removed: false };
    render(
      <ObjectPanel
        api={makeApi(update)}
        obj={config.objects[0]!}
        resolveObject={makeResolveObject(config.objects)}
        initialMode="edit"
        row={row}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit Work' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Mask');

    await userEvent.click(within(dialog).getByRole('button', { name: 'hu' }));
    const hu = within(dialog).getByLabelText('Title');
    expect(hu).toHaveValue('');
    expect(hu).toHaveAttribute('placeholder', 'Mask');
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('mask');

    await userEvent.type(hu, 'Maszk');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith('w1', expect.objectContaining({ title: { en: 'Mask', hu: 'Maszk' }, slug: 'mask' }));
  });
});
