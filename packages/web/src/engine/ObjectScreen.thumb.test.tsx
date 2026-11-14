import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { appConfig, loadConfig, setAppConfig, type ApiClient, type Config } from '@sprintster/engine';
import { ObjectScreen } from './ObjectScreen.js';
import { makeResolveObject, type Row } from './resolve.js';

const entity = (name: string, route: string, props: unknown[], columns: unknown[]) => ({
  name,
  title: name,
  titlePlural: `${name}s`,
  route,
  lifecycle: { softDelete: 'removed' },
  properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, ...props, { name: 'removed', type: 'boolean', system: true }],
  lists: [{ name: 'default', title: name, columns }],
});

const config = loadConfig({
  version: '1',
  objects: [
    entity('asset', 'media', [{ name: 'file', type: 'image' }], [{ property: 'file', thumbnail: true }]),
    entity('work', 'works', [{ name: 'title', type: 'text' }, { name: 'images', type: 'refs', target: 'asset' }], [
      { property: 'images', thumbnail: true },
      { property: 'title' },
    ]),
  ],
});

const data: Record<string, Row[]> = {
  asset: [
    { id: 'a1', file: { hash: 'big1', thumb: 'small1', filename: 'a.jpg', contentType: 'image/jpeg', size: 9 } },
    { id: 'a2', file: { hash: 'big2', filename: 'b.jpg', contentType: 'image/jpeg', size: 9 } },
  ],
  work: [
    { id: 'w1', title: 'Mask', images: ['a1', 'a2'] },
    { id: 'w2', title: 'Untitled', images: [] },
  ],
};
const asked: Array<readonly string[] | undefined> = [];
// As the server answers a list page (ADR 24): a ref thumbnail column's `#thumb` field carries the first referenced image.
const api = {
  object: (name: string) => ({
    page: async ({ fields }: { fields?: readonly string[] }) => {
      asked.push(fields);
      const rows = (data[name] ?? []).map((r) =>
        name === 'work' ? { ...r, 'images#thumb': data['asset']!.find((a) => a.id === (r['images'] as string[])[0])?.['file'] ?? null } : r,
      );
      return { rows, total: rows.length, next: null };
    },
  }),
} as unknown as ApiClient;

let previous: Config;
beforeAll(() => {
  previous = appConfig;
  setAppConfig(config);
});
afterAll(() => setAppConfig(previous));

describe('thumbnail columns', () => {
  it("shows the first referenced record's thumbnail in each row", async () => {
    const { container } = render(<ObjectScreen api={api} obj={config.objects[1]!} resolveObject={makeResolveObject(config.objects)} />);
    await screen.findByText('Mask');
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatch(/\/assets\/small1$/);
    expect(asked.at(-1)).toEqual(expect.arrayContaining(['images', 'images#thumb', 'title']));
  });

  it('falls back to the image itself when it has no thumbnail', async () => {
    const { container } = render(<ObjectScreen api={api} obj={config.objects[0]!} resolveObject={makeResolveObject(config.objects)} />);
    await screen.findAllByRole('row');
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(imgs.some((s) => s?.endsWith('/assets/big2'))).toBe(true);
  });
});
