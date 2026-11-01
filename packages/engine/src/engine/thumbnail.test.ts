import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/loader.js';
import { compileCreateSchema } from '../config/compile.js';
import { imagePropertyOf, listColumns, thumbnailHash } from './list.js';

const obj = (name: string, route: string, props: unknown[], columns: unknown[]) => ({
  name,
  title: name,
  titlePlural: name,
  route,
  lifecycle: { softDelete: 'removed' },
  properties: [{ name: 'id', type: 'id', strategy: 'uuid', system: true }, ...props, { name: 'removed', type: 'boolean', system: true }],
  lists: [{ name: 'default', title: name, columns }],
});

const asset = (columns: unknown[] = [{ property: 'file', thumbnail: true }]) =>
  obj('asset', 'media', [{ name: 'file', type: 'image' }, { name: 'title', type: 'text' }], columns);
const work = (columns: unknown[]) =>
  obj('work', 'works', [{ name: 'title', type: 'text' }, { name: 'images', type: 'refs', target: 'asset' }, { name: 'cover', type: 'ref', target: 'asset' }], columns);

describe('thumbnail columns', () => {
  it('accepts an image property and a ref or refs to an object with one', () => {
    const config = loadConfig({
      version: '1',
      objects: [asset(), work([{ property: 'images', thumbnail: true }, { property: 'cover', thumbnail: true }, { property: 'title' }])],
    });
    expect(listColumns(config.objects[1]!).map((c) => c.thumbnail)).toEqual([true, true, false]);
  });

  it('refuses a plain property or a target without an image', () => {
    expect(() => loadConfig({ version: '1', objects: [asset([{ property: 'title', thumbnail: true }])] })).toThrow(/must be an image property/);
    const noImage = obj('tag', 'tags', [{ name: 'name', type: 'text' }], [{ property: 'name' }]);
    const post = obj('post', 'posts', [{ name: 'tags', type: 'refs', target: 'tag' }], [{ property: 'tags', thumbnail: true }]);
    expect(() => loadConfig({ version: '1', objects: [noImage, post] })).toThrow(/has no image property/);
  });

  it('prefers the stored thumbnail, falling back to the image itself', () => {
    expect(thumbnailHash({ hash: 'big', thumb: 'small' })).toBe('small');
    expect(thumbnailHash({ hash: 'big' })).toBe('big');
    expect(thumbnailHash(null)).toBeNull();
    const config = loadConfig({ version: '1', objects: [asset()] });
    expect(imagePropertyOf(config.objects[0])).toBe('file');
  });

  it('stores a thumb hash on an image value', () => {
    const config = loadConfig({ version: '1', objects: [asset()] });
    const file = { hash: 'a', filename: 'a.jpg', contentType: 'image/jpeg', size: 1, thumb: 'b' };
    expect(compileCreateSchema(config.objects[0]!).safeParse({ id: '11111111-1111-4111-8111-111111111111', file }).success).toBe(true);
  });
});
