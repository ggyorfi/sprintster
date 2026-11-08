import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
      name: 'settings',
      title: 'Settings',
      titlePlural: 'Settings',
      route: 'settings',
      singleton: true,
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'leadTime', title: 'Lead time', type: 'text', translated: true },
      ],
      views: [{ name: 'default', title: 'Settings', fields: [{ property: 'leadTime' }] }],
    },
    {
      name: 'product',
      title: 'Product',
      titlePlural: 'Products',
      route: 'products',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'leadTime', title: 'Lead time', type: 'text', translated: true },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Products', columns: [{ property: 'leadTime' }] }],
      views: [{ name: 'default', title: 'Product', fields: [{ property: 'leadTime', placeholderFrom: 'settings.leadTime' }] }],
    },
  ],
});

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

const api = {
  object: (name: string) => ({
    list: async () => [],
    get: async () => (name === 'settings' ? { id: 'settings', leadTime: { en: '2 to 3 weeks', hu: '2-3 hét' } } : null),
  }),
} as unknown as ApiClient;

describe('placeholderFrom', () => {
  it("shows the singleton's current value, in the language being edited", async () => {
    const row: Row = { id: 'p1', leadTime: {}, removed: false };
    render(
      <ObjectPanel
        api={api}
        obj={config.objects[1]!}
        resolveObject={makeResolveObject(config.objects)}
        initialMode="edit"
        row={row}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit Product' });
    expect(await within(dialog).findByPlaceholderText('2 to 3 weeks')).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'hu' }));
    expect(within(dialog).getByLabelText('Lead time')).toHaveAttribute('placeholder', '2-3 hét');
  });
});
