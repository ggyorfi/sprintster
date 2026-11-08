import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { appConfig, loadConfig, setAppConfig, type ApiClient, type Config } from '@sprintster/engine';
import { ObjectPanel } from './ObjectPanel.js';
import { makeResolveObject, type Row } from './resolve.js';

const config = loadConfig({
  version: '1',
  objects: [
    {
      name: 'product',
      title: 'Product',
      titlePlural: 'Products',
      route: 'products',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'stockBy', title: 'Stock counted', type: 'enum', values: ['total', 'size'], default: 'total' },
        { name: 'stock', title: 'Stock', type: 'integer' },
        { name: 'sizes', title: 'Sizes', type: 'text' },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Products', columns: [{ property: 'stock' }] }],
      views: [
        {
          name: 'default',
          title: 'Product',
          fields: [
            { property: 'stockBy' },
            { property: 'stock', visibleWhen: { property: 'stockBy', equals: 'total' } },
            { kind: 'fieldset', title: 'By size', visibleWhen: { property: 'stockBy', equals: 'size' }, fields: [{ property: 'sizes' }] },
          ],
        },
      ],
    },
  ],
});

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

describe('visibleWhen in the form', () => {
  it('swaps fields as the controlling value changes and keeps hidden values on save', async () => {
    const update = vi.fn(async () => ({}));
    const api = { object: () => ({ list: async () => [], update }) } as unknown as ApiClient;
    const row: Row = { id: 'p1', stockBy: 'total', stock: 3, sizes: 'M:2', removed: false };
    render(
      <ObjectPanel api={api} obj={config.objects[0]!} resolveObject={makeResolveObject(config.objects)} initialMode="edit" row={row} onClose={() => {}} onChanged={() => {}} />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit Product' });
    expect(within(dialog).getByLabelText('Stock')).toHaveValue('3');
    expect(within(dialog).queryByLabelText('Sizes')).toBeNull();
    await userEvent.selectOptions(within(dialog).getByLabelText('Stock counted'), 'size');
    expect(within(dialog).queryByLabelText('Stock')).toBeNull();
    expect(within(dialog).getByLabelText('Sizes')).toHaveValue('M:2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith('p1', expect.objectContaining({ stockBy: 'size', stock: 3, sizes: 'M:2' }));
  });
});
