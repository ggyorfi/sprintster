import { describe, it, expect } from 'vitest';
import {
  createObjectApi,
  InMemoryEventStore,
  fixtureClientConfig,
  fixtureStatusObject,
  fixtureRefClientObject,
  fixtureMemoObject,
  type ObjectConfig,
  type PluginObjectApi,
} from '@sprintster/engine';
import { createApp } from './app.js';

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

describe('createApp', () => {
  it('GET /health returns 200', async () => {
    const { app } = buildApp();
    expect((await app.request('/health')).status).toBe(200);
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
    expect(await (await app.request('/clients')).json()).toEqual([]);
  });

  it('excludes removed clients', async () => {
    const { app, clientApi } = buildApp();
    await clientApi.add(validInput);
    await clientApi.add({ ...validInput, id: ID_B, name: 'Thomas' });
    await clientApi.remove!(ID_A);
    const body = (await (await app.request('/clients')).json()) as Array<{ id: string }>;
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
    expect((await res.json() as Array<{ id: string }>).length).toBe(1);
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
