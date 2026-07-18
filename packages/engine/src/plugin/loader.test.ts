import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { collectPluginObjects, deriveNamespace, isMissingHostEntry, loadPlugins } from './loader.js';
import type { PluginContext, PluginManifest } from './types.js';
import type { ObjectConfig } from '../config/schema.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('deriveNamespace', () => {
  it('strips the @sprintster/plugin- prefix from a scoped package name', () => {
    expect(deriveNamespace('@sprintster/plugin-google-contacts')).toBe('google-contacts');
  });
  it('strips a bare plugin- prefix', () => {
    expect(deriveNamespace('plugin-foo')).toBe('foo');
  });
  it('returns the package name as-is when no recognised prefix matches', () => {
    expect(deriveNamespace('my-extension')).toBe('my-extension');
  });
  it('respects an explicit override', () => {
    expect(deriveNamespace('@sprintster/plugin-google-contacts', 'google')).toBe('google');
  });
});

describe('collectPluginObjects', () => {
  const fakeObject: ObjectConfig = {
    name: 'contact',
    title: 'Contact',
    titlePlural: 'Contacts',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Contacts', columns: [{ property: 'id' }] }],
    forms: [],
  };

  it('pre-fetches contributedObjects from enabled plugins', async () => {
    const out = await collectPluginObjects({
      entries: [{ name: '@sprintster/plugin-google-contacts', enabled: true }],
      resolveShared: async () => ({ contributedObjects: [fakeObject] }),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.objects[0]?.name).toBe('contact');
    expect(out[0]?.namespace).toBe('google-contacts');
  });

  it('skips disabled plugins', async () => {
    const resolver = vi.fn();
    const out = await collectPluginObjects({
      entries: [{ name: '@sprintster/plugin-x', enabled: false }],
      resolveShared: resolver,
    });
    expect(out).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('silently skips when resolveShared returns null (no shared entry)', async () => {
    const out = await collectPluginObjects({
      entries: [{ name: '@sprintster/plugin-cli-only', enabled: true }],
      resolveShared: async () => null,
    });
    expect(out).toEqual([]);
  });

  it('skips when contributedObjects is absent or empty', async () => {
    const out = await collectPluginObjects({
      entries: [
        { name: '@sprintster/plugin-empty', enabled: true },
        { name: '@sprintster/plugin-absent', enabled: true },
      ],
      resolveShared: async (n) =>
        n === '@sprintster/plugin-empty' ? { contributedObjects: [] } : {},
    });
    expect(out).toEqual([]);
  });
});

describe('isMissingHostEntry', () => {
  it('matches Node module-not-found error codes', () => {
    expect(isMissingHostEntry({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(true);
    expect(isMissingHostEntry({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })).toBe(true);
  });
  it('rejects other errors', () => {
    expect(isMissingHostEntry(new Error('something else'))).toBe(false);
    expect(isMissingHostEntry(null)).toBe(false);
    expect(isMissingHostEntry({ code: 'EACCES' })).toBe(false);
  });
});

describe('loadPlugins', () => {
  function makePlugin(name: string, namespace?: string): PluginManifest<PluginContext> {
    return {
      name,
      namespace: namespace ?? deriveNamespace(name),
      version: '0.0.0',
      capabilities: [],
      config: z.object({ greeting: z.string().default('hi') }),
      init: vi.fn(),
    };
  }

  it('skips disabled entries', async () => {
    const a = makePlugin('@sprintster/plugin-a');
    const b = makePlugin('@sprintster/plugin-b');
    const loaded = await loadPlugins({
      entries: [
        { name: a.name, enabled: false },
        { name: b.name, enabled: true },
      ],
      resolve: async (n) => ({ plugin: n === a.name ? a : b }),
      buildContext: () => ({ config: {}, logger: silent }),
      logger: silent,
    });
    expect(loaded.map((p) => p.manifest.name)).toEqual([b.name]);
    expect(a.init).not.toHaveBeenCalled();
    expect(b.init).toHaveBeenCalledOnce();
  });

  it('throws on namespace collision (two plugins claim the same namespace)', async () => {
    const a = makePlugin('@sprintster/plugin-a', 'shared');
    const b = makePlugin('@sprintster/plugin-b', 'shared');
    await expect(
      loadPlugins({
        entries: [{ name: a.name }, { name: b.name }],
        resolve: async (n) => ({ plugin: n === a.name ? a : b }),
        buildContext: () => ({ config: {}, logger: silent }),
        logger: silent,
      }),
    ).rejects.toThrow(/namespace collision/);
  });

  it('validates the plugin config slice against the manifest schema and passes the parsed result to buildContext', async () => {
    const a = makePlugin('@sprintster/plugin-a');
    const builder = vi.fn().mockReturnValue({ config: {}, logger: silent });
    await loadPlugins({
      entries: [{ name: a.name, config: { greeting: 'hello' } }],
      resolve: async () => ({ plugin: a }),
      buildContext: builder,
      logger: silent,
    });
    expect(builder).toHaveBeenCalledWith(expect.anything(), 'a', { greeting: 'hello' });
  });

  it('fills config defaults when the entry omits the slice', async () => {
    const a = makePlugin('@sprintster/plugin-a');
    const builder = vi.fn().mockReturnValue({ config: {}, logger: silent });
    await loadPlugins({
      entries: [{ name: a.name }],
      resolve: async () => ({ plugin: a }),
      buildContext: builder,
      logger: silent,
    });
    expect(builder.mock.calls[0]?.[2]).toEqual({ greeting: 'hi' });
  });

  it('rejects an invalid plugin config slice with a clear error', async () => {
    const a: PluginManifest<PluginContext> = {
      ...makePlugin('@sprintster/plugin-a'),
      config: z.object({ port: z.number() }),
    };
    await expect(
      loadPlugins({
        entries: [{ name: a.name, config: { port: 'not-a-number' } }],
        resolve: async () => ({ plugin: a }),
        buildContext: () => ({ config: {}, logger: silent }),
        logger: silent,
      }),
    ).rejects.toThrow(/config is invalid/);
  });

  it('silently skips when resolve returns null (plugin has no entry for this host)', async () => {
    const b = makePlugin('@sprintster/plugin-b');
    const logger = { ...silent, error: vi.fn(), warn: vi.fn() };
    const loaded = await loadPlugins({
      entries: [{ name: '@sprintster/plugin-cli-only' }, { name: b.name }],
      resolve: async (n) => (n === '@sprintster/plugin-cli-only' ? null : { plugin: b }),
      buildContext: () => ({ config: {}, logger: silent }),
      logger,
    });
    expect(loaded.map((p) => p.namespace)).toEqual(['b']);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs and continues when resolve throws (other plugins still load)', async () => {
    const b = makePlugin('@sprintster/plugin-b');
    const logger = { ...silent, error: vi.fn() };
    const loaded = await loadPlugins({
      entries: [{ name: '@sprintster/plugin-missing' }, { name: b.name }],
      resolve: async (n) => {
        if (n === '@sprintster/plugin-missing') throw new Error('module not found');
        return { plugin: b };
      },
      buildContext: () => ({ config: {}, logger: silent }),
      logger,
    });
    expect(loaded.map((p) => p.namespace)).toEqual(['b']);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
