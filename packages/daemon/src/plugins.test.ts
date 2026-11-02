import { describe, it, expect } from 'vitest';
import { InMemoryEventStore, loadConfig, setAppConfig, type DaemonPlugin, type ObjectConfig } from '@sprintster/engine';
import { buildApis } from './apis.js';
import { createApp } from './app.js';
import { loadDaemonPlugins, withContributedObjects, type PluginModule } from './plugins.js';

const note: ObjectConfig = loadConfig({
  version: '1',
  objects: [
    {
      name: 'note',
      title: 'Note',
      titlePlural: 'Notes',
      route: 'notes',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'title', type: 'text' },
        { name: 'removed', type: 'boolean', system: true },
      ],
    },
  ],
}).objects[0]!;

const marker: ObjectConfig = { ...note, name: 'marker', title: 'Marker', titlePlural: 'Markers', route: 'markers' };

const counter: DaemonPlugin = {
  name: 'plugin-counter',
  namespace: 'counter',
  version: '1',
  capabilities: [],
  config: { parse: (raw: { label?: string }) => ({ label: raw.label ?? 'Count' }) } as unknown as DaemonPlugin['config'],
  init(ctx) {
    const { label } = ctx.config as { label: string };
    ctx.routes.register({
      method: 'GET',
      path: '/status',
      handler: async () => Response.json({ text: `${(await ctx.data.object('note').list()).length} notes`, tone: 'info' }),
    });
    ctx.routes.register({
      method: 'POST',
      path: '/items/:id',
      handler: async (_req, params) => Response.json({ message: `${label} ${params['id']}` }),
    });
    ctx.gui.action({ id: 'count', label, route: '/items/x', hotkey: 'c' });
    ctx.gui.badge({ id: 'status', route: '/status', refresh: 10 });
  },
};

const modules: Record<string, PluginModule> = { 'plugin-counter': { plugin: counter, contributedObjects: [marker] } };
const resolve = async (name: string) => modules[name] ?? null;

async function setup(plugins: unknown[] = [{ name: 'plugin-counter', config: { label: 'Tally' } }]) {
  const config = await withContributedObjects(loadConfig({ version: '1', objects: [note], plugins }), resolve);
  setAppConfig(config);
  const store = new InMemoryEventStore();
  const apis = buildApis(config, store);
  const loaded = await loadDaemonPlugins({ config, store, apis, resolve, logger: { info() {}, warn() {}, error() {} } });
  return { store, app: createApp({ apis, store, plugins: loaded }), apis };
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('daemon plugins', () => {
  it('mounts plugin routes under /plugins/<namespace>, with params and the app data', async () => {
    const { app } = await setup();
    await app.request('/notes', post({ id: '11111111-1111-4111-8111-111111111111', title: 'a' }));
    expect(await (await app.request('/plugins/counter/status')).json()).toEqual({ text: '1 notes', tone: 'info' });
    expect(await (await app.request('/plugins/counter/items/7', { method: 'POST' })).json()).toEqual({ message: 'Tally 7' });
  });

  it('lists declared actions and badges in /config with namespaced ids and full routes', async () => {
    const { app } = await setup();
    const body = (await (await app.request('/config')).json()) as { extensions: unknown; objects: Array<{ name: string }> };
    expect(body.extensions).toEqual({
      actions: [{ id: 'counter.count', label: 'Tally', route: '/plugins/counter/items/x', hotkey: 'c' }],
      badges: [{ id: 'counter.status', route: '/plugins/counter/status', refresh: 10 }],
    });
    expect(body.objects.map((o) => o.name)).toEqual(['note', 'marker']);
  });

  it('stores and serves an object a plugin contributes', async () => {
    const { app } = await setup();
    const res = await app.request('/markers', post({ id: '22222222-2222-4222-8222-222222222222', title: 'm' }));
    expect(res.status).toBe(201);
  });

  it('answers an unknown plugin path as JSON 404', async () => {
    const { app } = await setup();
    const res = await app.request('/plugins/counter/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('loads nothing when the config names no plugins', async () => {
    const { app } = await setup([]);
    expect(await (await app.request('/config')).json()).toMatchObject({ extensions: { actions: [], badges: [] } });
  });
});

describe('GET /log', () => {
  it('reports the position and the changes after a given one, without internal streams', async () => {
    const { app } = await setup();
    const empty = (await (await app.request('/log')).json()) as { position: number; changes: unknown[] };
    expect(empty).toEqual({ position: 0, changes: [] });
    await app.request('/notes', post({ id: '11111111-1111-4111-8111-111111111111', title: 'a' }));
    const first = (await (await app.request('/log')).json()) as { position: number; changes: Array<{ object: string; id: string }> };
    expect(first.changes).toEqual([expect.objectContaining({ object: 'note', id: '11111111-1111-4111-8111-111111111111' })]);
    await app.request('/notes/11111111-1111-4111-8111-111111111111', { ...post({ title: 'b' }), method: 'PATCH' });
    const next = (await (await app.request(`/log?since=${first.position}`)).json()) as { position: number; changes: unknown[] };
    expect(next.position).toBeGreaterThan(first.position);
    expect(next.changes).toHaveLength(1);
  });

  it('rejects a malformed position', async () => {
    const { app } = await setup();
    expect((await app.request('/log?since=-1')).status).toBe(400);
  });

  it('reserves the log and plugins routes', () => {
    for (const route of ['log', 'plugins']) {
      expect(() => loadConfig({ version: '1', objects: [{ ...note, route }] })).toThrow(/reserved/);
    }
  });
});

describe('POST /log', () => {
  const event = (streamId: string, title: string) => ({
    partitionId: 0,
    streamType: 'note',
    streamId,
    streamVersion: 1,
    eventType: 'NoteAdded',
    eventVersion: 1,
    payload: { id: streamId, title, removed: false },
    occurredAt: '2026-01-01T00:00:00Z',
    actor: 'system',
    correlationId: null,
  });

  it('appends exported events at the given position and serves the records', async () => {
    const { app } = await setup([]);
    const res = await app.request('/log', post({ after: 0, events: [event('11111111-1111-4111-8111-111111111111', 'moved')] }));
    expect(await res.json()).toEqual({ position: 1 });
    expect(await (await app.request('/notes')).json()).toEqual([expect.objectContaining({ title: 'moved' })]);
  });

  it('refuses a batch that does not continue the log', async () => {
    const { app } = await setup([]);
    await app.request('/log', post({ after: 0, events: [event('11111111-1111-4111-8111-111111111111', 'a')] }));
    const res = await app.request('/log', post({ after: 0, events: [event('22222222-2222-4222-8222-222222222222', 'b')] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ position: 1 });
  });
});
