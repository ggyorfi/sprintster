import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createObjectApi,
  InMemoryEventStore,
  fixtureClientConfig,
  fixtureStatusObject,
  fixtureRefClientObject,
  fixtureMemoObject,
  fixtureAppRaw,
  appConfig,
  loadConfig,
  setAppConfig,
  type ObjectConfig,
  type PluginObjectApi,
} from '@sprintster/engine';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp, LIVE_PATH, type StaticFiles } from './app.js';

function buildApp() {
  const store = new InMemoryEventStore();
  const clientApi = createObjectApi<{ id: string }>(store, fixtureClientConfig);
  const widgetApi = createObjectApi<{ id: string }>(store, fixtureStatusObject);
  const app = createApp({
    apis: [
      { obj: fixtureClientConfig, api: clientApi },
      { obj: fixtureStatusObject, api: widgetApi },
    ],
  });
  return { store, clientApi, widgetApi, app };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_UNKNOWN = '99999999-9999-4999-8999-999999999999';

const validInput = {
  id: ID_A,
  name: 'Alfie Granger-Howell',
  service: 'student',
  rate: '5000',
  paymentTermsDays: 7,
  address: null,
  notes: null,
};

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function patch(body: unknown): RequestInit {
  return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('the actor (ADR 20)', () => {
  const actorOfLastEvent = async (store: InMemoryEventStore) => (await store.findSince(0)).at(-1)?.actor;
  const create = (trustActor: boolean) => {
    const store = new InMemoryEventStore();
    const app = createApp({ apis: [{ obj: fixtureClientConfig, api: createObjectApi<{ id: string }>(store, fixtureClientConfig) }], trustActor });
    return { store, app };
  };
  const withActor = (init: RequestInit) => ({ ...init, headers: { ...(init.headers as Record<string, string>), 'Sprintster-Actor': 'anna' } });

  it('records the header\'s user on create, update and delete when the host vouches for it', async () => {
    const { store, app } = create(true);
    await app.request('/clients', withActor(json(validInput)));
    expect(await actorOfLastEvent(store)).toBe('anna');
    await app.request(`/clients/${ID_A}`, withActor(patch({ name: 'Renamed' })));
    expect(await actorOfLastEvent(store)).toBe('anna');
  });

  it('ignores the header unless the host vouches for it', async () => {
    const { store, app } = create(false);
    await app.request('/clients', withActor(json(validInput)));
    expect(await actorOfLastEvent(store)).toBe('system');
  });
});

describe('GET /<route>?at= (ADR 21)', () => {
  it('lists records as they were at the position, and refuses a bad one', async () => {
    const { store, app } = buildApp();
    await app.request('/clients', json(validInput));
    const before = await store.position();
    await app.request(`/clients/${ID_A}`, patch({ name: 'Renamed' }));
    expect(((await (await app.request(`/clients?at=${before}`)).json()) as Array<{ name: string }>).map((r) => r.name)).toEqual([validInput.name]);
    expect((await app.request('/clients?at=-1')).status).toBe(400);
  });
});

describe('createApp', () => {
  it('GET /health returns 200', async () => {
    const { app } = buildApp();
    expect((await app.request('/health')).status).toBe(200);
  });

  it('GET /health reports auth only when the config sets it', async () => {
    const before = appConfig;
    const auth = { login: '/_auth/login', logout: '/_auth/logout', refresh: '/_auth/refresh' };
    try {
      expect(await (await buildApp().app.request('/health')).json()).not.toHaveProperty('auth');
      setAppConfig(loadConfig({ ...(fixtureAppRaw as object), auth }));
      expect(await (await buildApp().app.request('/health')).json()).toMatchObject({ auth });
    } finally {
      setAppConfig(before);
    }
  });

  it('unknown route returns 404', async () => {
    const { app } = buildApp();
    expect((await app.request('/no-such-route')).status).toBe(404);
  });

  it('GET /config returns the mounted objects and theme, without plugin secrets', async () => {
    const { app } = buildApp();
    const res = await app.request('/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { objects: Array<{ name: string }>; theme: unknown; plugins?: unknown };
    expect(body.objects.map((o) => o.name)).toContain('client');
    expect(body.theme).toBeDefined();
    expect(body.plugins).toBeUndefined();
  });

  it('GET /config carries the app title only when one is configured', async () => {
    const { app } = buildApp();
    expect((await (await app.request('/config')).json()) as { title?: string }).not.toHaveProperty('title');
    const previous = appConfig;
    setAppConfig(loadConfig({ ...fixtureAppRaw, title: 'Harbour CMS' }));
    try {
      expect(((await (await app.request('/config')).json()) as { title?: string }).title).toBe('Harbour CMS');
    } finally {
      setAppConfig(previous);
    }
  });

  it('GET /config carries the locales only when configured', async () => {
    const { app } = buildApp();
    expect(await (await app.request('/config')).json()).not.toHaveProperty('locales');
    const previous = appConfig;
    setAppConfig(loadConfig({ ...fixtureAppRaw, locales: ['en', 'hu'] }));
    try {
      expect(((await (await app.request('/config')).json()) as { locales?: string[] }).locales).toEqual(['en', 'hu']);
    } finally {
      setAppConfig(previous);
    }
  });
});

describe('POST /clients', () => {
  it('creates a client and returns 201', async () => {
    const { app } = buildApp();
    const res = await app.request('/clients', json(validInput));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).toBe(ID_A);
  });

  it('rejects a non-UUID id with 400', async () => {
    const { app } = buildApp();
    expect((await app.request('/clients', json({ ...validInput, id: 'GRA-A26' }))).status).toBe(400);
  });

  it('refuses duplicate id with 409', async () => {
    const { app } = buildApp();
    await app.request('/clients', json(validInput));
    expect((await app.request('/clients', json(validInput))).status).toBe(409);
  });
});

describe('GET /clients/:id', () => {
  it('returns 404 when not found', async () => {
    const { app } = buildApp();
    expect((await app.request(`/clients/${ID_UNKNOWN}`)).status).toBe(404);
  });

  it('returns the client when present', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    const res = await app.request(`/clients/${ID_A}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(ID_A);
  });
});

describe('GET /clients', () => {
  it('returns an empty array when no clients exist', async () => {
    const { app } = buildApp();
    expect(await (await app.request('/clients')).json()).toEqual({ rows: [], total: 0, next: null });
  });

  it('excludes removed clients', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    await clientApi.add({ ...validInput, id: ID_B, name: 'Thomas' });
    await clientApi.remove!(ID_A);
    const body = ((await (await app.request('/clients')).json()) as { rows: Array<{ id: string }> }).rows;
    expect(body.map((c) => c.id)).toEqual([ID_B]);
  });
});

describe('PATCH /clients/:id', () => {
  it('renames and returns the new state', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    const res = await app.request(`/clients/${ID_A}`, patch({ name: 'Alfie' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('Alfie');
  });

  it('updates several fields in one request', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    const res = await app.request(`/clients/${ID_A}`, patch({ rate: '6000', service: 'accompaniment', paymentTermsDays: 30 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rate: string; service: string; paymentTermsDays: number };
    expect(body.rate).toBe('6000');
    expect(body.service).toBe('accompaniment');
    expect(body.paymentTermsDays).toBe(30);
  });

  it('updates the address', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    const res = await app.request(`/clients/${ID_A}`, patch({ address: { line1: '2 Park Road', line2: null, city: 'London', postcode: 'N1 9AA' } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { address: { postcode: string } }).address.postcode).toBe('N1 9AA');
  });

  it('clears notes when passed null', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add({ ...validInput, notes: 'something' });
    const res = await app.request(`/clients/${ID_A}`, patch({ notes: null }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { notes: string | null }).notes).toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp();
    expect((await app.request(`/clients/${ID_UNKNOWN}`, patch({ name: 'X' }))).status).toBe(404);
  });

  it('returns 400 for empty name, bad pence, and unknown keys', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    expect((await app.request(`/clients/${ID_A}`, patch({ name: '' }))).status).toBe(400);
    expect((await app.request(`/clients/${ID_A}`, patch({ rate: '60.00' }))).status).toBe(400);
    expect((await app.request(`/clients/${ID_A}`, patch({ bogus: 1 }))).status).toBe(400);
  });
});

describe('DELETE /clients/:id', () => {
  it('marks the client as removed', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    const res = await app.request(`/clients/${ID_A}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { removed: boolean }).removed).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const { app } = buildApp();
    expect((await app.request(`/clients/${ID_UNKNOWN}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('returns 409 when already removed', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    await clientApi.remove!(ID_A);
    expect((await app.request(`/clients/${ID_A}`, { method: 'DELETE' })).status).toBe(409);
  });
});

describe('ref object (/memos): existence checked on write', () => {
  const MEMO_ID = '33333333-3333-4333-8333-333333333333';

  function buildRefApp() {
    const store = new InMemoryEventStore();
    const clientApi = createObjectApi<{ id: string }>(store, fixtureRefClientObject);
    const memoApi = createObjectApi<{ id: string }>(store, fixtureMemoObject, {
      resolveTarget: (name) => (name === 'client' ? clientApi : undefined),
    });
    const app = createApp({
      apis: [
        { obj: fixtureRefClientObject, api: clientApi },
        { obj: fixtureMemoObject, api: memoApi },
      ],
    });
    return { store, clientApi, memoApi, app };
  }

  it('POST accepts a memo whose client exists (201)', async () => {
    const { app, clientApi } = buildRefApp();
    await clientApi.add(validInput);
    const res = await app.request('/memos', json({ id: MEMO_ID, client: ID_A, text: 'call back' }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { client: string }).client).toBe(ID_A);
  });

  it('POST rejects a memo whose client does not exist (404)', async () => {
    const { app } = buildRefApp();
    expect((await app.request('/memos', json({ id: MEMO_ID, client: ID_UNKNOWN, text: 'x' }))).status).toBe(404);
  });

  it('POST rejects a memo whose client was removed (409)', async () => {
    const { app, clientApi } = buildRefApp();
    await clientApi.add(validInput);
    await clientApi.remove!(ID_A);
    expect((await app.request('/memos', json({ id: MEMO_ID, client: ID_A, text: 'x' }))).status).toBe(409);
  });
});

describe('statusField object (/widgets): generic mount, no delete', () => {
  it('POST initialises the status enum default', async () => {
    const { app } = buildApp();
    const res = await app.request('/widgets', json({ id: ID_A, label: 'A' }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe('live');
  });

  it('PATCH updates an ordinary field', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    const res = await app.request(`/widgets/${ID_A}`, patch({ label: 'B' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { label: string }).label).toBe('B');
  });

  it('PATCH rejects the status lifecycle field with 400 (transitions are named commands)', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    expect((await app.request(`/widgets/${ID_A}`, patch({ status: 'cancelled' }))).status).toBe(400);
  });

  it('DELETE is not registered (404, soft-delete only)', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    expect((await app.request(`/widgets/${ID_A}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('plugin-style read-only api (only list/get/requireGet)', () => {
  const noteConfig: ObjectConfig = {
    name: 'note',
    title: 'Note',
    titlePlural: 'Notes',
    route: 'notes',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'title', title: 'Title', type: 'text' },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [
      {
        name: 'default',
        title: 'Notes',
        columns: [{ property: 'id', label: 'ID', width: 10 }],
      },
    ],
    forms: [{ name: 'default', title: 'New', fields: [{ property: 'title' }] }],
  };
  const rows = [{ id: ID_A, title: 'hello', removed: false }];
  const readOnlyApi: PluginObjectApi<{ id: string }> = {
    list: async () => rows as Array<{ id: string }>,
    get: async (id) => (rows.find((r) => r.id === id) as { id: string } | undefined) ?? null,
    requireGet: async (id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error(`note '${id}' not found`);
      return row as { id: string };
    },
  };
  const app = createApp({ apis: [{ obj: noteConfig, api: readOnlyApi }] });

  it('GET /notes returns rows', async () => {
    const res = await app.request('/notes');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: Array<{ id: string }> }).rows.length).toBe(1);
  });

  it('GET /notes/:id returns 200 when found, 404 when not', async () => {
    expect((await app.request(`/notes/${ID_A}`)).status).toBe(200);
    expect((await app.request(`/notes/${ID_UNKNOWN}`)).status).toBe(404);
  });

  it('POST /notes is not registered (404 because add is absent)', async () => {
    expect((await app.request('/notes', json({ title: 'x' }))).status).toBe(404);
  });

  it('PATCH /notes/:id is not registered (404 because update is absent)', async () => {
    expect((await app.request(`/notes/${ID_A}`, patch({ title: 'y' }))).status).toBe(404);
  });

  it('DELETE /notes/:id is not registered (404 because remove is absent)', async () => {
    expect((await app.request(`/notes/${ID_A}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('PATCH /widgets/:id with _command (status transitions)', () => {
  it('runs the cancel transition and reflects the new status', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    const res = await app.request(`/widgets/${ID_A}`, patch({ _command: 'cancel' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('cancelled');
  });

  it('runs the markPaid transition', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    const res = await app.request(`/widgets/${ID_A}`, patch({ _command: 'markPaid' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('paid');
  });

  it('returns 400 for an unknown command', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    expect((await app.request(`/widgets/${ID_A}`, patch({ _command: 'frobnicate' }))).status).toBe(400);
  });

  it('returns 409 when the current state is not in the command from-set', async () => {
    const { app, widgetApi } = buildApp();
    await widgetApi.add({ id: ID_A, label: 'A' });
    await widgetApi.runCommand(ID_A, 'cancel');
    expect((await app.request(`/widgets/${ID_A}`, patch({ _command: 'cancel' }))).status).toBe(409);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();
    expect((await app.request(`/widgets/${ID_UNKNOWN}`, patch({ _command: 'cancel' }))).status).toBe(404);
  });
});

describe('externally-backed object: status / sync / refresh routes', () => {
  const thingConfig: ObjectConfig = {
    name: 'thing',
    title: 'Thing',
    titlePlural: 'Things',
    route: 'things',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [{ name: 'default', title: 'Things', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
  };

  function buildThings(opts: { withRefresh: boolean }) {
    const status = { lastSyncedAt: 1700000000000, syncing: false, lastError: null, count: 1 };
    const syncCalls: number[] = [];
    const api: PluginObjectApi<{ id: string }> = {
      list: async () => [{ id: ID_A }],
      get: async (id) => (id === ID_A ? { id: ID_A } : null),
      requireGet: async (id) => ({ id }),
      status: async () => status,
      sync: async () => {
        syncCalls.push(1);
        return { ...status, count: 2 };
      },
    };
    if (opts.withRefresh) {
      api.refresh = async (id) => (id === ID_A ? { id: ID_A } : null);
    }
    return { app: createApp({ apis: [{ obj: thingConfig, api }] }), syncCalls };
  }

  it('GET /things/_status returns the status payload (not treated as an id)', async () => {
    const { app } = buildThings({ withRefresh: true });
    const res = await app.request('/things/_status');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(1);
  });

  it('POST /things/_sync triggers a sync and returns the new status', async () => {
    const { app, syncCalls } = buildThings({ withRefresh: true });
    const res = await app.request('/things/_sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(2);
    expect(syncCalls.length).toBe(1);
  });

  it('POST /things/:id/_refresh returns 200 when found, 404 when not', async () => {
    const { app } = buildThings({ withRefresh: true });
    expect((await app.request(`/things/${ID_A}/_refresh`, { method: 'POST' })).status).toBe(200);
    expect((await app.request(`/things/${ID_UNKNOWN}/_refresh`, { method: 'POST' })).status).toBe(404);
  });

  it('refresh route is absent when the api does not implement it', async () => {
    const { app } = buildThings({ withRefresh: false });
    expect((await app.request(`/things/${ID_A}/_refresh`, { method: 'POST' })).status).toBe(404);
  });
});

describe('static web hosting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprintster-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>App</title><div id="root"></div>');
  writeFileSync(join(dir, 'app.js'), 'console.log("bundle")');

  function withWeb() {
    const store = new InMemoryEventStore();
    const clientApi = createObjectApi<{ id: string }>(store, fixtureClientConfig);
    const web: StaticFiles = (path) => serveStatic(path === undefined ? { root: dir } : { path, root: dir });
    return createApp({ apis: [{ obj: fixtureClientConfig, api: clientApi }], web });
  }

  it('serves index.html at /', async () => {
    const res = await withWeb().request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('serves static assets', async () => {
    const res = await withWeb().request('/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('bundle');
  });

  it('falls back to index.html for client-side routes (SPA)', async () => {
    const res = await withWeb().request('/anything/deep');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('404s a missing file instead of returning index.html', async () => {
    const app = withWeb();
    expect((await app.request('/_app/missing.js')).status).toBe(404);
    expect((await app.request('/missing.css')).status).toBe(404);
  });

  it('does not let the web catch-all shadow the API', async () => {
    const app = withWeb();
    expect((await app.request('/health')).status).toBe(200);
    const cfg = await app.request('/config');
    expect(((await cfg.json()) as { objects: unknown[] }).objects.length).toBe(1);
    expect((await app.request('/clients')).status).toBe(200);
  });

  it('404s as JSON under an API namespace instead of returning index.html', async () => {
    const app = withWeb();
    for (const path of [`/clients/${ID_A}/extra`, '/clients/one/two', '/health/x', '/config/x']) {
      const res = await app.request(path);
      expect([path, res.status]).toEqual([path, 404]);
      expect((await res.json()) as { code: string }).toMatchObject({ code: 'not_found' });
    }
  });

  it('still falls back to index.html outside the API namespaces', async () => {
    const app = withWeb();
    for (const path of ['/unknown-object', '/clients-archive/deep', '/client']) {
      const res = await app.request(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(await res.text()).toContain('id="root"');
    }
  });
});

describe('object route paths', () => {
  function mount(obj: ObjectConfig) {
    const store = new InMemoryEventStore();
    return createApp({ apis: [{ obj, api: createObjectApi<{ id: string }>(store, obj) }] });
  }

  function objWith(over: Partial<ObjectConfig>): ObjectConfig {
    return {
      name: 'settings',
      title: 'Site Setting',
      titlePlural: 'Site Settings',
      route: 'site-settings',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'removed', type: 'boolean', system: true },
      ],
      lists: [{ name: 'default', title: 'Settings', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
      ...over,
    };
  }

  it('mounts the declared route', async () => {
    const app = mount(objWith({}));
    expect((await app.request('/site-settings')).status).toBe(200);
  });

  it('mounts whatever route is declared, whatever the label says', async () => {
    const app = mount(objWith({ route: 'config-panel' }));
    expect((await app.request('/config-panel')).status).toBe(200);
    expect((await app.request('/site-settings')).status).toBe(404);
  });

  it('does not move when the label is renamed, which is why the route is declared', async () => {
    const app = mount(objWith({ title: 'Beállítás', titlePlural: 'Beállítások' }));
    expect((await app.request('/site-settings')).status).toBe(200);
    expect((await app.request('/beallitasok')).status).toBe(404);
  });

  it('does not mount the raw label with a space in it', async () => {
    const app = mount(objWith({}));
    expect((await app.request('/site settings')).status).toBe(404);
    expect((await app.request('/site%20settings')).status).toBe(404);
  });
});

describe('GET /<route> pages (ADR 24)', () => {
  const names = ['Ann', 'Béla', 'Cecil', 'Dóra'];
  async function filled() {
    const built = buildApp();
    for (const [i, name] of names.entries()) await built.app.request('/clients', json({ ...validInput, id: `0000000${i}-0000-4000-8000-000000000000`, name, rate: String(1000 * (i + 1)) }));
    return built.app;
  }
  const get = async (app: Awaited<ReturnType<typeof filled>>, query: string) => (await (await app.request(`/clients${query}`)).json()) as { rows: Array<Record<string, unknown>>; total?: number; next: string | null };

  it('answers one page with the total, searches without case or accents, sorts and selects fields', async () => {
    const app = await filled();
    const page = await get(app, '?limit=2&offset=1&sort=-rate');
    expect(page.rows.map((r) => r['name'])).toEqual(['Cecil', 'Béla']);
    expect(page.total).toBe(4);
    expect((await get(app, '?q=dora')).rows.map((r) => r['name'])).toEqual(['Dóra']);
    expect((await get(app, '?fields=name&limit=1&sort=name')).rows).toEqual([{ id: '00000000-0000-4000-8000-000000000000', name: 'Ann' }]);
  });

  it('pages through every record by cursor', async () => {
    const app = await filled();
    const seen: unknown[] = [];
    let after = '';
    for (let i = 0; i < 5; i++) {
      const page = await get(app, `?limit=3&sort=name${after}`);
      seen.push(...page.rows.map((r) => r['name']));
      if (page.next === null) break;
      after = `&after=${page.next}`;
    }
    expect(seen).toEqual(names);
  });

  it('narrows the page by a named filter, and refuses an unknown one', async () => {
    const before = appConfig;
    const filtered = loadConfig({
      ...fixtureAppRaw,
      objects: fixtureAppRaw.objects.map((o: { name: string; lists?: unknown[] }) =>
        o.name === 'client' ? { ...o, lists: [{ ...(o.lists as Array<Record<string, unknown>>)[0], filters: [{ label: 'Rate', options: [{ label: 'High', property: 'rate', startsWith: '3' }] }] }] } : o,
      ),
    });
    setAppConfig(filtered);
    try {
      const store = new InMemoryEventStore();
      const obj = filtered.objects.find((o) => o.name === 'client')!;
      const app = createApp({ apis: [{ obj, api: createObjectApi<{ id: string }>(store, obj) }] });
      for (const [i, name] of names.entries()) await app.request('/clients', json({ ...validInput, id: `0000000${i}-0000-4000-8000-000000000000`, name, rate: String(1000 * (i + 1)) }));
      expect((await get(app, '?filter=Rate%3AHigh')).rows.map((r) => r['name'])).toEqual(['Cecil']);
      expect((await app.request('/clients?filter=Rate%3AMaybe')).status).toBe(400);
    } finally {
      setAppConfig(before);
    }
  });

  it('leaves out the total when asked not to count', async () => {
    const app = await filled();
    const page = await get(app, '?limit=2&offset=2&count=false&sort=name');
    expect(page.rows.map((r) => r['name'])).toEqual(['Cecil', 'Dóra']);
    expect(page.total).toBeUndefined();
  });

  it('refuses more than 100 rows and other bad parameters with 400', async () => {
    const app = await filled();
    for (const query of ['?limit=101', '?limit=0', '?offset=-1', '?sort=nope', '?fields=nope', '?after=zzz']) {
      expect((await app.request(`/clients${query}`)).status).toBe(400);
    }
  });
});

describe('plugin list columns (ADR 25)', () => {
  it('adds each column\'s value to the rows a list returns, in one call per list', async () => {
    const store = new InMemoryEventStore();
    const api = createObjectApi<{ id: string }>(store, fixtureClientConfig);
    const calls: string[][] = [];
    const plugins = {
      objects: [],
      routes: [],
      channels: [],
      extensions: { actions: [], badges: [], columns: [{ id: 'pub.state', label: 'State' }] },
      columns: [
        {
          id: 'pub.state',
          label: 'State',
          objects: [fixtureClientConfig.name],
          values: async (_object: string, ids: string[]) => {
            calls.push(ids);
            return Object.fromEntries(ids.map((id) => [id, { text: 'Pending', tone: 'danger' as const }]));
          },
        },
      ],
    };
    const app = createApp({ apis: [{ obj: fixtureClientConfig, api }], plugins });
    await app.request('/clients', json(validInput));
    const rows = ((await (await app.request('/clients')).json()) as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows[0]!['pub.state']).toEqual({ text: 'Pending', tone: 'danger' });
    expect(calls).toEqual([[ID_A]]);
  });
});

describe('the live log (ADR 28)', () => {
  it('pushes the position once per request that moved the log, never for one that did not', async () => {
    const store = new InMemoryEventStore();
    const api = createObjectApi<{ id: string }>(store, fixtureClientConfig);
    const sent: Array<[string, unknown]> = [];
    const app = createApp({ apis: [{ obj: fixtureClientConfig, api }], store, live: { send: (path, m) => sent.push([path, JSON.parse(m)]) } });
    await app.request('/clients');
    expect(sent).toEqual([]);
    await app.request('/clients', json(validInput));
    expect(sent).toEqual([[LIVE_PATH, { position: await store.position() }]]);
    await app.request(`/clients/${ID_A}`);
    await app.request('/clients', json(validInput));
    expect(sent).toHaveLength(1);
  });
});

describe('GET /<route>/_free', () => {
  const page: ObjectConfig = {
    name: 'page',
    title: 'Page',
    titlePlural: 'Pages',
    route: 'pages',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'slug', type: 'text', validation: { required: true, unique: true, caseInsensitive: true } },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [],
  };

  it('answers the first free value, and refuses a field that is not unique', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({ apis: [{ obj: page, api: createObjectApi<{ id: string }>(store, page) }] });
    await app.request('/pages', json({ id: ID_A, slug: 'Alma' }));
    expect(await (await app.request('/pages/_free?field=slug&value=alma')).json()).toEqual({ value: 'alma-2' });
    expect(await (await app.request(`/pages/_free?field=slug&value=alma&id=${ID_A}`)).json()).toEqual({ value: 'alma' });
    expect((await app.request('/pages/_free?field=removed&value=x')).status).toBe(409);
    expect((await app.request('/pages/_free?field=slug')).status).toBe(400);
  });
});
