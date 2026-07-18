import { describe, it, expect } from 'vitest';
import { createObjectApi } from './object-api.js';
import {
  fixtureClientConfig,
  fixtureStatusObject,
  fixtureRefClientObject,
  fixtureMemoObject,
} from '../config/fixture.js';
import { InMemoryEventStore } from '../events/store.js';
import {
  AlreadyExistsError,
  InvalidStateError,
  NotFoundError,
  UniqueFieldError,
  isApiError,
} from '../errors/api-error.js';
import type { ObjectConfig } from '../config/schema.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_UNKNOWN = '99999999-9999-4999-8999-999999999999';

function buildApi() {
  const store = new InMemoryEventStore();
  const api = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureClientConfig);
  return { store, api };
}

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID_A,
    name: 'Alfie Granger-Howell',
    service: 'student',
    rate: '5000',
    paymentTermsDays: 7,
    address: null,
    notes: null,
    ...overrides,
  };
}

const fieldOf = (payload: unknown): unknown => (payload as Record<string, unknown>)['field'];

describe('createObjectApi over the client config: add', () => {
  it('creates and returns the folded state', async () => {
    const { api } = buildApi();
    const c = await api.add(validInput());
    expect(c.id).toBe(ID_A);
    expect(c['name']).toBe('Alfie Granger-Howell');
    expect(c['rate']).toBe('5000');
    expect(c['address']).toBeNull();
    expect(c['removed']).toBe(false);
  });

  it('persists notes and address supplied at creation', async () => {
    const { api } = buildApi();
    const c = await api.add(
      validInput({
        notes: 'Legacy id GRA-A26.',
        address: { line1: '51 Belsize Square', line2: null, city: 'London', postcode: 'NW3 4HX' },
      }),
    );
    expect(c['notes']).toBe('Legacy id GRA-A26.');
    expect((c['address'] as Record<string, unknown>)['postcode']).toBe('NW3 4HX');
  });

  it('rejects a non-UUID id', async () => {
    const { api } = buildApi();
    await expect(api.add(validInput({ id: 'GRA-A26' }))).rejects.toThrow();
  });

  it('fills config defaults when service and terms are omitted', async () => {
    const { api } = buildApi();
    const c = await api.add({ id: ID_A, name: 'X', rate: '5000', address: null, notes: null });
    expect(c['service']).toBe('student');
    expect(c['paymentTermsDays']).toBe(7);
  });

  it('refuses an id that already exists', async () => {
    const { api } = buildApi();
    await api.add(validInput());
    await expect(api.add(validInput())).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it('uses the configured actor name and emits ClientAdded', async () => {
    const store = new InMemoryEventStore();
    const api = createObjectApi(store, fixtureClientConfig, { actor: 'somebody-else' });
    await api.add(validInput());
    const events = await store.findByStream(0, 'client', ID_A);
    expect(events[0]?.eventType).toBe('ClientAdded');
    expect(events[0]?.actor).toBe('somebody-else');
  });

  it('respects a non-zero partition', async () => {
    const store = new InMemoryEventStore();
    const api = createObjectApi(store, fixtureClientConfig, { partitionId: 7 });
    await api.add(validInput());
    expect((await store.findByStream(0, 'client', ID_A)).length).toBe(0);
    expect((await store.findByStream(7, 'client', ID_A)).length).toBe(1);
  });
});

describe('createObjectApi over the client config: update', () => {
  it('emits ClientFieldChanged(name) and reflects the new name', async () => {
    const { store, api } = buildApi();
    await api.add(validInput());
    const out = await api.update(ID_A, { name: 'Alfie G-H' });
    expect(out['name']).toBe('Alfie G-H');
    expect(out['rate']).toBe('5000');
    const events = await store.findByStream(0, 'client', ID_A);
    expect(events.map((e) => e.eventType)).toEqual(['ClientAdded', 'ClientFieldChanged']);
    expect(fieldOf(events[1]?.payload)).toBe('name');
  });

  it('emits one event per changed field, in patch order', async () => {
    const { store, api } = buildApi();
    await api.add(validInput());
    await api.update(ID_A, { name: 'Alfie', rate: '6000', paymentTermsDays: 14 });
    const events = await store.findByStream(0, 'client', ID_A);
    expect(events.map((e) => e.eventType)).toEqual([
      'ClientAdded',
      'ClientFieldChanged',
      'ClientFieldChanged',
      'ClientFieldChanged',
    ]);
    expect(events.slice(1).map((e) => fieldOf(e.payload))).toEqual(['name', 'rate', 'paymentTermsDays']);
  });

  it('emits nothing when the patch matches current state (no-op)', async () => {
    const { store, api } = buildApi();
    await api.add(validInput());
    await api.update(ID_A, { name: 'Alfie Granger-Howell', rate: '5000' });
    expect((await store.findByStream(0, 'client', ID_A)).length).toBe(1);
  });

  it('throws NotFoundError for an unknown id', async () => {
    const { api } = buildApi();
    await expect(api.update(ID_UNKNOWN, { name: 'Nobody' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to update a removed client', async () => {
    const { api } = buildApi();
    await api.add(validInput());
    await api.remove!(ID_A);
    await expect(api.update(ID_A, { name: 'New' })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('rejects invalid field input and unknown patch keys (strict on write)', async () => {
    const { api } = buildApi();
    await api.add(validInput());
    await expect(api.update(ID_A, { name: '' })).rejects.toThrow();
    await expect(api.update(ID_A, { paymentTermsDays: 0 })).rejects.toThrow();
    await expect(api.update(ID_A, { rate: '50.00' })).rejects.toThrow();
    await expect(api.update(ID_A, { bogus: 1 })).rejects.toThrow();
  });
});

describe('createObjectApi over the client config: remove / get / list', () => {
  it('marks removed and refuses double-remove', async () => {
    const { api } = buildApi();
    await api.add(validInput());
    const out = await api.remove!(ID_A);
    expect(out['removed']).toBe(true);
    await expect(api.remove!(ID_A)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('refuses to remove a non-existent client', async () => {
    const { api } = buildApi();
    await expect(api.remove!(ID_UNKNOWN)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('list excludes removed; get still returns removed; requireGet throws', async () => {
    const { api } = buildApi();
    await api.add(validInput({ id: ID_A }));
    await api.add(validInput({ id: ID_B, name: 'Thomas Lam' }));
    await api.remove!(ID_A);
    expect((await api.list()).map((c) => c.id)).toEqual([ID_B]);
    expect((await api.get(ID_A))?.['removed']).toBe(true);
    try {
      await api.requireGet(ID_A);
      throw new Error('expected InvalidStateError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidStateError);
      expect(isApiError(err)).toBe(true);
    }
  });
});

describe('createObjectApi over a statusField object (genericity proof)', () => {
  function buildWidget() {
    const store = new InMemoryEventStore();
    const api = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureStatusObject);
    return { store, api };
  }

  it('initialises the status enum to its config default on create', async () => {
    const { store, api } = buildWidget();
    const w = await api.add({ id: ID_A, label: 'A' });
    expect(w['status']).toBe('live');
    expect((await store.findByStream(0, 'widget', ID_A))[0]?.eventType).toBe('WidgetAdded');
  });

  it('updates an ordinary field via WidgetFieldChanged', async () => {
    const { store, api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    const out = await api.update(ID_A, { label: 'B' });
    expect(out['label']).toBe('B');
    expect((await store.findByStream(0, 'widget', ID_A))[1]?.eventType).toBe('WidgetFieldChanged');
  });

  it('excludes the status lifecycle field from the update patch (transitions are named commands, not field edits)', async () => {
    const { api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    await expect(api.update(ID_A, { status: 'cancelled' })).rejects.toThrow();
  });

  it('exposes no remove() and lists all rows (no soft-delete)', async () => {
    const { api } = buildWidget();
    expect(api.remove).toBeUndefined();
    await api.add({ id: ID_A, label: 'A' });
    await api.add({ id: ID_B, label: 'B' });
    expect((await api.list()).map((w) => w.id).sort()).toEqual([ID_A, ID_B].sort());
  });
});

describe('createObjectApi: sequence field allocation', () => {
  function buildWidget() {
    const store = new InMemoryEventStore();
    const api = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureStatusObject);
    return { store, api };
  }

  it('allocates an incrementing number per create, folded into the projection', async () => {
    const { api } = buildWidget();
    const a = await api.add({ id: ID_A, label: 'A' });
    const b = await api.add({ id: ID_B, label: 'B' });
    expect(a['number']).toBe(1);
    expect(b['number']).toBe(2);
  });

  it('writes the allocated number into the Added event payload (deterministic replay)', async () => {
    const { store, api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    const ev = (await store.findByStream(0, 'widget', ID_A))[0];
    expect((ev?.payload as Record<string, unknown>)['number']).toBe(1);
  });

  it('rejects a client-supplied sequence value (daemon-owned, excluded from input)', async () => {
    const { api } = buildWidget();
    await expect(api.add({ id: ID_A, label: 'A', number: 99 })).rejects.toThrow();
  });

  it('reuses the existing stream so its head is the last allocation (O(1))', async () => {
    const { store, api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    await api.add({ id: ID_B, label: 'B' });
    expect(await store.streamHead(0, '__seq', 'widget.number')).toBe(2);
  });
});

describe('createObjectApi: statusField transitions via runCommand', () => {
  function buildWidget() {
    const store = new InMemoryEventStore();
    const api = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureStatusObject);
    return { store, api };
  }

  it('runCommand(cancel) sets status to cancelled and emits a WidgetCancelled event', async () => {
    const { store, api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    const out = await api.runCommand(ID_A, 'cancel');
    expect(out['status']).toBe('cancelled');
    const events = await store.findByStream(0, 'widget', ID_A);
    expect(events.map((e) => e.eventType)).toEqual(['WidgetAdded', 'WidgetCancelled']);
    expect((events[1]?.payload as Record<string, unknown>)['widget_id']).toBe(ID_A);
  });

  it('runCommand(markPaid) sets status to paid and emits a WidgetPaid event', async () => {
    const { store, api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    const out = await api.runCommand(ID_A, 'markPaid');
    expect(out['status']).toBe('paid');
    expect((await store.findByStream(0, 'widget', ID_A))[1]?.eventType).toBe('WidgetPaid');
  });

  it('rejects a command whose `from` set does not include the current status', async () => {
    const { api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    await api.runCommand(ID_A, 'cancel');
    await expect(api.runCommand(ID_A, 'cancel')).rejects.toBeInstanceOf(InvalidStateError);
    await expect(api.runCommand(ID_A, 'markPaid')).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('rejects an unknown command', async () => {
    const { api } = buildWidget();
    await api.add({ id: ID_A, label: 'A' });
    await expect(api.runCommand(ID_A, 'frobnicate')).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('rejects runCommand on a non-existent object with NotFoundError', async () => {
    const { api } = buildWidget();
    await expect(api.runCommand(ID_UNKNOWN, 'cancel')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exposes the configured command list on the api', async () => {
    const { api } = buildWidget();
    expect(api.commands.map((c) => c.name)).toEqual(['cancel', 'markPaid']);
  });
});

describe('createObjectApi: ref field existence check', () => {
  const MEMO_ID = '33333333-3333-4333-8333-333333333333';

  function buildRefApis() {
    const store = new InMemoryEventStore();
    const clientApi = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureRefClientObject);
    const memoApi = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureMemoObject, {
      resolveTarget: (name) => (name === 'client' ? clientApi : undefined),
    });
    return { store, clientApi, memoApi };
  }

  async function addClient(api: ReturnType<typeof buildRefApis>['clientApi'], id: string): Promise<void> {
    await api.add({ id, name: 'Alfie', service: 'student', rate: '5000', paymentTermsDays: 7, address: null, notes: null });
  }

  it('accepts a ref pointing at a live target', async () => {
    const { clientApi, memoApi } = buildRefApis();
    await addClient(clientApi, ID_A);
    const m = await memoApi.add({ id: MEMO_ID, client: ID_A, text: 'call back' });
    expect(m['client']).toBe(ID_A);
  });

  it('rejects a ref pointing at a non-existent target', async () => {
    const { memoApi } = buildRefApis();
    await expect(memoApi.add({ id: MEMO_ID, client: ID_UNKNOWN, text: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a ref pointing at a removed target', async () => {
    const { clientApi, memoApi } = buildRefApis();
    await addClient(clientApi, ID_A);
    await clientApi.remove!(ID_A);
    await expect(memoApi.add({ id: MEMO_ID, client: ID_A, text: 'x' })).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('checks the ref again on update', async () => {
    const { clientApi, memoApi } = buildRefApis();
    await addClient(clientApi, ID_A);
    await addClient(clientApi, ID_B);
    await memoApi.add({ id: MEMO_ID, client: ID_A, text: 'x' });
    const out = await memoApi.update(MEMO_ID, { client: ID_B });
    expect(out['client']).toBe(ID_B);
    await expect(memoApi.update(MEMO_ID, { client: ID_UNKNOWN })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws when a ref is present but no resolver is wired', async () => {
    const store = new InMemoryEventStore();
    const memoApi = createObjectApi<Record<string, unknown> & { id: string }>(store, fixtureMemoObject);
    await expect(memoApi.add({ id: MEMO_ID, client: ID_A, text: 'x' })).rejects.toBeInstanceOf(InvalidStateError);
  });
});

describe('createObjectApi: field-level unique validation', () => {
  const pageObject: ObjectConfig = {
    name: 'page',
    title: 'Page',
    titlePlural: 'Pages',
    lifecycle: { softDelete: 'removed' },
    properties: [
      { name: 'id', type: 'id', strategy: 'uuid', system: true },
      { name: 'slug', type: 'text', validation: { required: true, unique: true } },
      { name: 'code', type: 'text', nullable: true, validation: { unique: true } },
      { name: 'title', type: 'text', nullable: true },
      { name: 'removed', type: 'boolean', system: true },
    ],
    lists: [],
  };

  function buildPages() {
    const store = new InMemoryEventStore();
    const api = createObjectApi<Record<string, unknown> & { id: string }>(store, pageObject);
    return { store, api };
  }

  it('accepts distinct values for a unique field', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null, title: 'Home' });
    await api.add({ id: ID_B, slug: 'about', code: null, title: 'About' });
    expect((await api.list()).map((p) => p['slug']).sort()).toEqual(['about', 'home']);
  });

  it('rejects a second record with a duplicate unique value', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null, title: 'Home' });
    await expect(api.add({ id: ID_B, slug: 'home', code: null, title: 'Dup' })).rejects.toBeInstanceOf(UniqueFieldError);
    expect((await api.list()).length).toBe(1);
  });

  it('surfaces a clear 409 field error', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    try {
      await api.add({ id: ID_B, slug: 'home', code: null });
      throw new Error('expected UniqueFieldError');
    } catch (err) {
      expect(err).toBeInstanceOf(UniqueFieldError);
      expect(isApiError(err)).toBe(true);
      expect((err as UniqueFieldError).statusCode).toBe(409);
      expect((err as UniqueFieldError).field).toBe('slug');
    }
  });

  it('does not constrain null/absent unique values', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    await api.add({ id: ID_B, slug: 'about', code: null });
    expect((await api.list()).length).toBe(2);
  });

  it('allows reusing a value after the holder is soft-deleted', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    await api.remove!(ID_A);
    await api.add({ id: ID_B, slug: 'home', code: null });
    expect((await api.get(ID_B))?.['slug']).toBe('home');
  });

  it('frees the old value and claims the new on update', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    await api.update(ID_A, { slug: 'about' });
    // 'home' is now free to reuse
    await api.add({ id: ID_B, slug: 'home', code: null });
    // but 'about' is now held by A
    await expect(api.update(ID_B, { slug: 'about' })).rejects.toBeInstanceOf(UniqueFieldError);
  });

  it("rejects updating one record to another live record's value, leaving it unchanged", async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    await api.add({ id: ID_B, slug: 'about', code: null });
    await expect(api.update(ID_B, { slug: 'home' })).rejects.toBeInstanceOf(UniqueFieldError);
    expect((await api.get(ID_B))?.['slug']).toBe('about');
  });

  it('permits a no-op update of a unique field to its own value', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: null });
    const out = await api.update(ID_A, { slug: 'home' });
    expect(out['slug']).toBe('home');
  });

  it('enforces a second independent unique field', async () => {
    const { api } = buildPages();
    await api.add({ id: ID_A, slug: 'home', code: 'X1' });
    await expect(api.add({ id: ID_B, slug: 'about', code: 'X1' })).rejects.toBeInstanceOf(UniqueFieldError);
  });

  it('does not claim uniqueness when the object has no unique fields (fixture parity)', async () => {
    const { api } = buildApi();
    await api.add(validInput({ id: ID_A }));
    await api.add(validInput({ id: ID_B, name: 'Alfie Granger-Howell' }));
    expect((await api.list()).length).toBe(2);
  });
});
