import { describe, it, expect, vi } from 'vitest';
import { backlinkSources, rowReferences, findBacklinks } from './backlinks.js';
import type { ObjectConfig } from '../config/schema.js';

const tag: ObjectConfig = {
  name: 'tag',
  title: 'Tag',
  titlePlural: 'Tags',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'label', type: 'text' },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [],
};
const user: ObjectConfig = { ...tag, name: 'user', title: 'User', titlePlural: 'Users' };
const post: ObjectConfig = {
  name: 'post',
  title: 'Post',
  titlePlural: 'Posts',
  lifecycle: { softDelete: 'removed' },
  properties: [
    { name: 'id', type: 'id', strategy: 'uuid', system: true },
    { name: 'author', type: 'ref', target: 'user' },
    { name: 'tags', type: 'refs', target: 'tag' },
    { name: 'primaryTag', type: 'ref', target: 'tag' },
    { name: 'removed', type: 'boolean', system: true },
  ],
  lists: [],
};
const objects = [tag, user, post];

describe('backlinkSources', () => {
  it('finds every ref/refs field across objects that targets a given object', () => {
    expect(backlinkSources(objects, 'tag')).toEqual([
      { object: post, field: 'tags', multi: true },
      { object: post, field: 'primaryTag', multi: false },
    ]);
  });

  it('finds a single forward ref field', () => {
    expect(backlinkSources(objects, 'user')).toEqual([{ object: post, field: 'author', multi: false }]);
  });

  it('returns nothing when no field targets the object', () => {
    expect(backlinkSources(objects, 'post')).toEqual([]);
  });
});

describe('rowReferences', () => {
  it('matches a single ref by id', () => {
    expect(rowReferences({ author: 'u1' }, 'author', false, 'u1')).toBe(true);
    expect(rowReferences({ author: 'u2' }, 'author', false, 'u1')).toBe(false);
  });

  it('matches a multi ref when the id is in the array', () => {
    expect(rowReferences({ tags: ['a', 'b'] }, 'tags', true, 'b')).toBe(true);
    expect(rowReferences({ tags: ['a', 'b'] }, 'tags', true, 'c')).toBe(false);
  });

  it('is false for null, undefined, or a non-array multi value', () => {
    expect(rowReferences({ tags: null }, 'tags', true, 'a')).toBe(false);
    expect(rowReferences({}, 'tags', true, 'a')).toBe(false);
    expect(rowReferences({ tags: 'a' }, 'tags', true, 'a')).toBe(false);
  });
});

describe('findBacklinks', () => {
  it('groups referencing rows per (object, field), loading each object once', async () => {
    const rowsByObject: Record<string, Array<Record<string, unknown>>> = {
      post: [
        { id: 'p1', tags: ['t1'], primaryTag: 't2' },
        { id: 'p2', tags: ['t1', 't2'], primaryTag: 't1' },
        { id: 'p3', tags: [], primaryTag: null },
      ],
    };
    const loadRows = vi.fn(async (name: string) => rowsByObject[name] ?? []);

    const groups = await findBacklinks(objects, 'tag', 't1', loadRows);

    expect(groups).toEqual([
      { object: 'post', field: 'tags', rows: [rowsByObject.post![0], rowsByObject.post![1]] },
      { object: 'post', field: 'primaryTag', rows: [rowsByObject.post![1]] },
    ]);
    expect(loadRows).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list when nothing references the target', async () => {
    const loadRows = vi.fn(async () => []);
    expect(await findBacklinks(objects, 'user', 'u9', loadRows)).toEqual([{ object: 'post', field: 'author', rows: [] }]);
  });
});
