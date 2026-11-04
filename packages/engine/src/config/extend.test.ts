import { describe, it, expect } from 'vitest';
import { extendConfig } from './extend.js';

describe('extendConfig', () => {
  it('merges objects key by key and replaces arrays and scalars', () => {
    const base = { app: { title: 'Base', locales: ['en', 'hu'], objects: [{ name: 'work' }] }, keep: 1 };
    const site = { extends: '../base.json', app: { title: 'Site', locales: ['hu', 'en'] } };
    expect(extendConfig(base, site)).toEqual({
      app: { title: 'Site', locales: ['hu', 'en'], objects: [{ name: 'work' }] },
      keep: 1,
    });
  });

  it('drops only the top-level extends key', () => {
    expect(extendConfig({ a: { extends: 'x' } }, { extends: 'y', a: { b: 1 } })).toEqual({ a: { extends: 'x', b: 1 } });
  });

  it('lets the site replace an object with a non-object', () => {
    expect(extendConfig({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });

  it('does not change its inputs', () => {
    const base = { a: { b: 1 } };
    extendConfig(base, { a: { c: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });
});
