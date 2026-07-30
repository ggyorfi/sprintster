import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config/loader.js';
import { createObjectApi } from './object-api.js';
import { singletonId, synthesizeSingleton } from './singleton.js';
import { InMemoryEventStore } from '../events/store.js';
import { InvalidStateError } from '../errors/api-error.js';
import type { ObjectConfig } from '../config/schema.js';

function settings(props: unknown[] = []): ObjectConfig {
  type Prop = { name: string; type: string; properties?: Array<{ name: string }> };
  const fieldPaths = (p: Prop): string[] =>
    p.type === 'object' ? (p.properties ?? []).map((sub) => `${p.name}.${sub.name}`) : [p.name];
  const names = ['siteTitle', ...(props as Prop[]).flatMap(fieldPaths)];
  return loadConfig({
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
          { name: 'siteTitle', type: 'text', default: 'My site' },
          ...props,
        ],
        lists: [],
        views: [{ name: 'default', title: 'Settings', fields: names.map((n) => ({ property: n })) }],
      },
    ],
  }).objects[0]!;
}

describe('synthesizeSingleton', () => {
  it('uses declared defaults', () => {
    expect(synthesizeSingleton(settings())['siteTitle']).toBe('My site');
  });

  it('projects type zero values for fields without a default', () => {
    const obj = settings([
      { name: 'baseUrl', type: 'text' },
      { name: 'perPage', type: 'integer' },
      { name: 'enabled', type: 'boolean' },
      { name: 'price', type: 'money', currency: 'GBP' },
      { name: 'tags', type: 'refs', target: 'settings' },
      { name: 'publishedAt', type: 'datetime' },
    ]);
    const rec = synthesizeSingleton(obj);
    expect(rec['baseUrl']).toBe('');
    expect(rec['perPage']).toBe(0);
    expect(rec['enabled']).toBe(false);
    expect(rec['price']).toBe('0');
    expect(rec['tags']).toEqual([]);
    expect(rec['publishedAt']).toBeNull();
  });

  it('recurses into object properties', () => {
    const obj = settings([
      { name: 'social', type: 'object', properties: [{ name: 'twitter', type: 'text' }, { name: 'followers', type: 'integer' }] },
    ]);
    expect(synthesizeSingleton(obj)['social']).toEqual({ twitter: '', followers: 0 });
  });

  it('always reports the same id', () => {
    expect(synthesizeSingleton(settings())['id']).toBe(singletonId(settings()));
  });
});

describe('singleton object api', () => {
  function api(obj = settings([{ name: 'baseUrl', type: 'text' }])) {
    return createObjectApi<{ id: string }>(new InMemoryEventStore(), obj);
  }

  it('constructs without a lifecycle', () => {
    expect(() => api()).not.toThrow();
  });

  it('reads as an object before anything is saved', async () => {
    const rec = (await api().get('settings')) as Record<string, unknown>;
    expect(rec['siteTitle']).toBe('My site');
    expect(rec['baseUrl']).toBe('');
  });

  it('lists exactly one record, always', async () => {
    const a = api();
    expect(await a.list()).toHaveLength(1);
    await a.update('settings', { baseUrl: 'https://example.com' });
    expect(await a.list()).toHaveLength(1);
  });

  it('persists the first save and keeps defaults for untouched fields', async () => {
    const a = api();
    await a.update('settings', { baseUrl: 'https://example.com' });
    const rec = (await a.get('settings')) as Record<string, unknown>;
    expect(rec['baseUrl']).toBe('https://example.com');
    expect(rec['siteTitle']).toBe('My site');
  });

  it('updates again after the record exists', async () => {
    const a = api();
    await a.update('settings', { baseUrl: 'https://one.example' });
    await a.update('settings', { baseUrl: 'https://two.example' });
    expect(((await a.get('settings')) as Record<string, unknown>)['baseUrl']).toBe('https://two.example');
  });

  it('ignores the id argument, since there is only one record', async () => {
    const a = api();
    await a.update('anything-at-all', { baseUrl: 'https://example.com' });
    expect(((await a.get('other')) as Record<string, unknown>)['baseUrl']).toBe('https://example.com');
  });

  it('refuses creation: a second record is not representable', async () => {
    await expect(api().add({ siteTitle: 'x' })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('exposes no remove', () => {
    expect(api().remove).toBeUndefined();
  });

  it('projects a field added to the config after the first save', async () => {
    const store = new InMemoryEventStore();
    const before = settings([{ name: 'baseUrl', type: 'text' }]);
    await createObjectApi<{ id: string }>(store, before).update('settings', { baseUrl: 'https://example.com' });

    const after = settings([{ name: 'baseUrl', type: 'text' }, { name: 'perPage', type: 'integer' }]);
    const rec = (await createObjectApi<{ id: string }>(store, after).get('settings')) as Record<string, unknown>;
    expect(rec['baseUrl']).toBe('https://example.com');
    expect(rec['perPage']).toBe(0);
  });
});
