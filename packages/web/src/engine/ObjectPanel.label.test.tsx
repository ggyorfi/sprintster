import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { appConfig, loadConfig, setAppConfig, type ApiClient, type Config } from '@sprintster/engine';
import { ObjectPanel } from './ObjectPanel.js';
import { makeResolveObject, type Row } from './resolve.js';

const config = loadConfig({
  version: '1',
  objects: [
    {
      name: 'settings', title: 'Settings', titlePlural: 'Settings', route: 'settings', singleton: true,
      properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, { name: 'one', type: 'text' }, { name: 'two', type: 'text' }],
      views: [{ name: 'default', title: 'Settings', fields: [{ property: 'one' }, { property: 'two' }] }],
    },
    {
      name: 'product', title: 'Product', titlePlural: 'Products', route: 'products', lifecycle: { softDelete: 'removed' },
      properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, { name: 'a', type: 'text' }, { name: 'b', type: 'text' }, { name: 'removed', type: 'boolean', system: true }],
      lists: [{ name: 'default', title: 'Products', columns: [{ property: 'a' }] }],
      views: [{ name: 'default', title: 'Product', fields: [{ property: 'a', labelFrom: 'settings.one' }, { property: 'b', labelFrom: 'settings.two' }] }],
    },
  ],
});

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

describe('labelFrom', () => {
  it('labels a field from the singleton and hides it while that is empty', async () => {
    const api = { object: () => ({ list: async () => [], get: async () => ({ id: 'settings', one: 'Stone', two: '' }) }) } as unknown as ApiClient;
    const row: Row = { id: 'p', a: '', b: '', removed: false };
    render(<ObjectPanel api={api} obj={config.objects[1]!} resolveObject={makeResolveObject(config.objects)} initialMode="edit" row={row} onClose={() => {}} onChanged={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByLabelText('Stone')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
  });
});
