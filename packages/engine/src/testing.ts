import type * as Vitest from 'vitest';
import { searchTerms, searchTextOf, type StateCondition, type StateCursor, type StatePage, type StateQuery } from './events/query.js';
import { UniqueViolationError, type EventInput, type EventStore, type StateStore } from './events/store.js';
import type { BlobStore } from './blobs/store.js';

function input(overrides: Partial<EventInput> = {}): EventInput {
  return {
    partitionId: 0,
    streamType: 'client',
    streamId: 'A',
    streamVersion: 1,
    eventType: 'ClientAdded',
    eventVersion: 1,
    payload: { foo: 'bar' },
    occurredAt: '2026-05-22T10:00:00.000Z',
    actor: 'tester',
    correlationId: null,
    ...overrides,
  };
}

// The caller's own vitest, so the cases register with the runner the adapter's tests run under (the Workers pool runs its own).
export type TestApi = Pick<typeof Vitest, 'describe' | 'it' | 'expect'>;

// The behaviour the engine relies on from every EventStore; each adapter runs it against a fresh store per case.
export function describeEventStore(
  { describe, it, expect }: TestApi,
  name: string,
  freshStore: () => EventStore | Promise<EventStore>,
): void {
  describe(`EventStore contract: ${name}`, () => {
    it('returns the appended event with a string id and an ISO recordedAt', async () => {
      const store = await freshStore();
      const row = await store.append(input());
      expect(row.id).toBeTypeOf('string');
      expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('reports a position that grows with every append, and the events after a position', async () => {
      const store = await freshStore();
      expect(await store.position()).toBe(0);
      const a = await store.append(input({ streamVersion: 1 }));
      const after = await store.position();
      expect(after).toBe(Number(a.id));
      await store.append(input({ streamVersion: 2 }));
      await store.append(input({ streamType: 'invoice', streamId: 'I', streamVersion: 1 }));
      expect(await store.position()).toBeGreaterThan(after);
      expect((await store.findSince(after)).map((r) => [r.streamType, r.streamVersion])).toEqual([
        ['client', 2],
        ['invoice', 1],
      ]);
      expect(await store.findSince(await store.position())).toEqual([]);
    });

    it('assigns a distinct id to every event', async () => {
      const store = await freshStore();
      const a = await store.append(input({ streamVersion: 1 }));
      const b = await store.append(input({ streamVersion: 2 }));
      expect(a.id).not.toBe(b.id);
    });

    it('reads back every field as written, the payload parsed', async () => {
      const store = await freshStore();
      const written = input({ payload: { nested: { list: [1, 'two', null] }, flag: true }, correlationId: 'c-1' });
      await store.append(written);
      const [row] = await store.findByStream(0, 'client', 'A');
      expect(row).toMatchObject(written);
    });

    it('rejects a duplicate (partition, streamType, streamId, streamVersion) with UniqueViolationError', async () => {
      const store = await freshStore();
      await store.append(input());
      await expect(store.append(input())).rejects.toBeInstanceOf(UniqueViolationError);
    });

    it('accepts exactly one of two concurrent appends at the same version', async () => {
      const store = await freshStore();
      const results = await Promise.allSettled([store.append(input()), store.append(input())]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(UniqueViolationError);
    });

    it('allows the same version on different streams, types and partitions', async () => {
      const store = await freshStore();
      await store.append(input());
      await store.append(input({ streamId: 'B' }));
      await store.append(input({ streamType: 'invoice' }));
      await store.append(input({ partitionId: 1 }));
      expect(await store.findByStream(0, 'client', 'A')).toHaveLength(1);
      expect(await store.findByStream(0, 'client', 'B')).toHaveLength(1);
    });

    it('findByStream returns one stream in version order, whatever the append order', async () => {
      const store = await freshStore();
      await store.append(input({ streamVersion: 2, payload: { v: 2 } }));
      await store.append(input({ streamVersion: 1, payload: { v: 1 } }));
      await store.append(input({ streamId: 'B' }));
      const rows = await store.findByStream(0, 'client', 'A');
      expect(rows.map((r) => r.payload)).toEqual([{ v: 1 }, { v: 2 }]);
    });

    it('findByStream returns nothing for an unknown stream', async () => {
      const store = await freshStore();
      expect(await store.findByStream(0, 'client', 'missing')).toEqual([]);
    });

    it('findByStreamType returns every stream of one type in insertion order', async () => {
      const store = await freshStore();
      await store.append(input({ streamId: 'A', streamVersion: 1 }));
      await store.append(input({ streamId: 'B', streamVersion: 1 }));
      await store.append(input({ streamType: 'invoice', streamId: 'X' }));
      await store.append(input({ streamId: 'A', streamVersion: 2 }));
      const rows = await store.findByStreamType(0, 'client');
      expect(rows.map((r) => `${r.streamId}${r.streamVersion}`)).toEqual(['A1', 'B1', 'A2']);
    });

    it('findByStreamType isolates partitions', async () => {
      const store = await freshStore();
      await store.append(input({ partitionId: 0 }));
      await store.append(input({ partitionId: 1 }));
      await store.append(input({ partitionId: 1, streamId: 'B' }));
      expect(await store.findByStreamType(0, 'client')).toHaveLength(1);
      expect(await store.findByStreamType(1, 'client')).toHaveLength(2);
    });

    it('streamHead returns the highest version of one stream, 0 when empty', async () => {
      const store = await freshStore();
      expect(await store.streamHead(0, 'client', 'A')).toBe(0);
      await store.append(input({ streamVersion: 1 }));
      await store.append(input({ streamVersion: 5 }));
      await store.append(input({ streamId: 'B', streamVersion: 9 }));
      expect(await store.streamHead(0, 'client', 'A')).toBe(5);
    });

    const marker = (streamVersion = 1) => input({ streamType: '__erased', streamId: 'A', streamVersion, eventType: 'RecordErased', payload: {} });

    it('rewriteStreams deletes a stream and moves the position past the deleted last event', async () => {
      const store = await freshStore();
      await store.append(input({ streamId: 'B' }));
      await store.append(input({ streamVersion: 1 }));
      const last = await store.append(input({ streamVersion: 2 }));
      const row = await store.rewriteStreams(marker(), [{ partitionId: 0, streamType: 'client', streamId: 'A', expectedVersion: 2, payloads: null }]);
      expect(await store.findByStream(0, 'client', 'A')).toEqual([]);
      expect(await store.findByStream(0, 'client', 'B')).toHaveLength(1);
      expect(Number(row.id)).toBeGreaterThan(Number(last.id));
      expect(await store.position()).toBe(Number(row.id));
      expect((await store.findSince(Number(last.id))).map((r) => r.streamType)).toEqual(['__erased']);
    });

    it('rewriteStreams replaces payloads by event id and leaves the rest', async () => {
      const store = await freshStore();
      const a = await store.append(input({ streamVersion: 1, payload: { name: 'Ann', city: 'X' } }));
      await store.append(input({ streamVersion: 2, payload: { field: 'city', value: 'Y' } }));
      await store.rewriteStreams(marker(), [{ partitionId: 0, streamType: 'client', streamId: 'A', expectedVersion: 2, payloads: new Map([[a.id, { name: null, city: 'X' }]]) }]);
      expect((await store.findByStream(0, 'client', 'A')).map((r) => r.payload)).toEqual([{ name: null, city: 'X' }, { field: 'city', value: 'Y' }]);
    });

    it('rewriteStreams refuses a stream whose head moved, and changes nothing', async () => {
      const store = await freshStore();
      await store.append(input({ streamVersion: 1 }));
      await store.append(input({ streamVersion: 2 }));
      const before = await store.position();
      await expect(
        store.rewriteStreams(marker(), [{ partitionId: 0, streamType: 'client', streamId: 'A', expectedVersion: 1, payloads: null }]),
      ).rejects.toBeInstanceOf(UniqueViolationError);
      expect(await store.findByStream(0, 'client', 'A')).toHaveLength(2);
      expect(await store.position()).toBe(before);
    });
  });
}

type WithStates = EventStore & { states: StateStore };

// The current-state behaviour the engine relies on, for a store that offers `states`.
export function describeStateStore(
  { describe, it, expect }: TestApi,
  name: string,
  freshStore: () => WithStates | Promise<WithStates>,
): void {
  describe(`StateStore contract: ${name}`, () => {
    it('stores what project returns, at the event version, and hands project the stored row', async () => {
      const store = await freshStore();
      const row = await store.states.appendWithState(input(), (r) => ({ seen: r.id, payload: r.payload }));
      expect(await store.states.getState(0, 'client', 'A')).toEqual({
        streamId: 'A',
        version: 1,
        state: { seen: row.id, payload: { foo: 'bar' } },
      });
    });

    it('returns null for a stream with no state', async () => {
      const store = await freshStore();
      expect(await store.states.getState(0, 'client', 'missing')).toBeNull();
    });

    it('appends nothing and keeps the old state when project throws', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input(), () => ({ n: 1 }));
      await expect(
        store.states.appendWithState(input({ streamVersion: 2 }), () => {
          throw new Error('refused');
        }),
      ).rejects.toThrow('refused');
      expect(await store.streamHead(0, 'client', 'A')).toBe(1);
      expect(await store.states.getState(0, 'client', 'A')).toMatchObject({ version: 1, state: { n: 1 } });
    });

    it('rewriteStreams stores the given state, and removes it with the stream', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input(), () => ({ name: 'Ann' }));
      const rewrite = { partitionId: 0, streamType: 'client', streamId: 'A', expectedVersion: 1 };
      await store.rewriteStreams(input({ streamType: '__erased', eventType: 'RecordRedacted' }), [{ ...rewrite, payloads: new Map(), state: { name: null } }]);
      expect(await store.states.getState(0, 'client', 'A')).toEqual({ streamId: 'A', version: 1, state: { name: null } });
      await store.rewriteStreams(input({ streamType: '__erased', streamVersion: 2, eventType: 'RecordErased' }), [{ ...rewrite, payloads: null }]);
      expect(await store.states.getState(0, 'client', 'A')).toBeNull();
      expect(await store.states.statesStale(0, 'client')).toBe(false);
    });

    it('keeps the old state when the append loses a version race', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input(), () => ({ n: 1 }));
      await expect(store.states.appendWithState(input(), () => ({ n: 2 }))).rejects.toBeInstanceOf(UniqueViolationError);
      expect(await store.states.getState(0, 'client', 'A')).toMatchObject({ version: 1, state: { n: 1 } });
    });

    it('lists states in order of first event, isolated by partition and type', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input({ streamId: 'B' }), () => 'b1');
      await store.states.appendWithState(input({ streamId: 'A' }), () => 'a1');
      await store.states.appendWithState(input({ streamId: 'B', streamVersion: 2 }), () => 'b2');
      await store.states.appendWithState(input({ streamType: 'invoice', streamId: 'X' }), () => 'x');
      await store.states.appendWithState(input({ partitionId: 1, streamId: 'Y' }), () => 'y');
      expect((await store.states.listStates(0, 'client')).map((s) => s.state)).toEqual(['b2', 'a1']);
    });

    it('reports stale states only when the log has moved past them', async () => {
      const store = await freshStore();
      expect(await store.states.statesStale(0, 'client')).toBe(false);
      await store.states.appendWithState(input(), () => 1);
      await store.append(input({ streamType: 'invoice' }));
      expect(await store.states.statesStale(0, 'client')).toBe(false);
      await store.append(input({ streamVersion: 2 }));
      expect(await store.states.statesStale(0, 'client')).toBe(true);
      await store.append(input({ streamId: 'B' }));
      await store.states.replaceStates(0, 'client', [
        { streamId: 'A', version: 2, state: 2 },
        { streamId: 'B', version: 1, state: 'b' },
      ]);
      expect(await store.states.statesStale(0, 'client')).toBe(false);
    });

    it('reports states verified only after they were replaced under the same search key, per type', async () => {
      const store = await freshStore();
      expect(await store.states.statesVerified(0, 'client', 'name')).toBe(false);
      await store.states.appendWithState(input(), () => 1);
      expect(await store.states.statesVerified(0, 'client', 'name')).toBe(false);
      await store.states.replaceStates(0, 'client', [{ streamId: 'A', version: 1, state: 1 }], 'name');
      expect(await store.states.statesVerified(0, 'client', 'name')).toBe(true);
      expect(await store.states.statesVerified(0, 'client', 'name,notes')).toBe(false);
      expect(await store.states.statesVerified(0, 'invoice', 'name')).toBe(false);
    });

    it('replaceStates swaps every state of one type, in the order given, and leaves other types alone', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input({ streamId: 'old' }), () => 'gone');
      await store.states.appendWithState(input({ streamType: 'invoice', streamId: 'X' }), () => 'x');
      await store.states.replaceStates(0, 'client', [
        { streamId: 'B', version: 3, state: { b: true } },
        { streamId: 'A', version: 1, state: null },
      ]);
      expect(await store.states.listStates(0, 'client')).toEqual([
        { streamId: 'B', version: 3, state: { b: true } },
        { streamId: 'A', version: 1, state: null },
      ]);
      expect(await store.states.getState(0, 'client', 'old')).toBeNull();
      expect(await store.states.listStates(0, 'invoice')).toHaveLength(1);
    });
  });
}

// ADR 24 and 26: every store answers every query the same way; the in-memory store's answer is the reference.
export function describeStateQuery(
  { describe, it, expect }: TestApi,
  name: string,
  freshStore: () => WithStates | Promise<WithStates>,
): void {
  const fields = ['title', 'body'];
  const searchOf = (state: unknown) => searchTextOf(state, fields);
  const articles: Array<[string, Record<string, unknown>]> = [
    ['a1', { title: 'Óra terv', body: 'Angol', rank: 3, top: true, section: 's2', removed: false, file: { contentType: 'image/png' } }],
    ['a2', { title: 'ora', body: null, rank: 1, top: false, section: 's1', removed: false, file: { contentType: 'application/pdf' } }],
    ['a3', { title: 'Zebra', body: 'kör', rank: 2, top: true, section: null, removed: false }],
    ['a4', { title: null, body: 'Óra', rank: null, top: null, section: 's1', removed: false }],
    ['a5', { title: 'Alma', body: 'kor', rank: 3, top: false, section: 's2', removed: false }],
    ['a6', { title: 'Törölt', body: 'óra', rank: 9, top: true, section: 's1', removed: true }],
    ['b7', { title: 'alma', body: 'ÓRA', rank: 2, top: false, section: 's9', removed: false }],
  ];
  const sections: Array<[string, Record<string, unknown>]> = [
    ['s1', { title: 'Hírek' }],
    ['s2', { title: 'Angol' }],
  ];
  async function seeded(): Promise<WithStates> {
    const store = await freshStore();
    for (const [id, state] of articles) await store.states.appendWithState(input({ streamType: 'article', streamId: id }), () => state, searchOf);
    for (const [id, state] of sections) await store.states.appendWithState(input({ streamType: 'section', streamId: id }), () => state);
    await store.states.appendWithState(input({ partitionId: 1, streamType: 'article', streamId: 'x1' }), () => ({ title: 'ora' }), searchOf);
    await store.states.appendWithState(input({ streamType: 'other', streamId: 'o1' }), () => ({ title: 'ora' }), searchOf);
    return store;
  }
  const base = { partitionId: 0, streamType: 'article', limit: 50 };
  const ids = (page: { states: Array<{ streamId: string }> }) => page.states.map((s) => s.streamId);
  async function walk(store: WithStates, q: Omit<StateQuery, 'limit' | 'after' | 'offset'>, limit: number): Promise<string[]> {
    const seen: string[] = [];
    let after: StateCursor | null = null;
    for (let i = 0; i < 20; i++) {
      const page: StatePage = await store.states.query({ ...q, limit, after });
      seen.push(...ids(page));
      if (page.next === null) return seen;
      after = page.next;
    }
    throw new Error('cursor did not end');
  }

  describe(`StateStore query contract: ${name}`, () => {
    it('keeps a type\'s totals right through writes, hides, erasures and rebuilds (ADR 28)', async () => {
      const store = await seeded();
      const rebuild = async (keep: (id: string) => boolean) => {
        const all = (await store.states.listStates(0, 'article')).filter((s) => keep(s.streamId));
        await store.states.replaceStates(0, 'article', all.map((s) => ({ ...s, search: searchOf(s.state) })), fields.join(','));
      };
      const totals = async () => [
        (await store.states.query({ ...base, limit: 1 })).total,
        (await store.states.query({ ...base, limit: 1, hide: 'removed' })).total,
        (await store.states.query({ ...base, limit: 1 })).total,
      ];
      await rebuild(() => true);
      expect(await totals()).toEqual([7, 6, 7]);
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a8' }), () => ({ title: 'Új', removed: false }), searchOf);
      expect(await totals()).toEqual([8, 7, 8]);
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a1', streamVersion: 2 }), () => ({ title: 'Óra terv', removed: true }), searchOf);
      expect(await totals()).toEqual([8, 6, 8]);
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a6', streamVersion: 2 }), () => ({ title: 'Vissza', removed: false }), searchOf);
      expect(await totals()).toEqual([8, 7, 8]);
      await store.rewriteStreams(input({ streamType: '__erased', streamId: 'a2', eventType: 'RecordErased' }), [
        { partitionId: 0, streamType: 'article', streamId: 'a2', expectedVersion: 1, payloads: null },
      ]);
      expect(await totals()).toEqual([7, 6, 7]);
      await rebuild((id) => id !== 'a3');
      expect(await totals()).toEqual([6, 5, 6]);
      expect((await store.states.query({ ...base, limit: 1, hide: 'removed', terms: searchTerms('ora') })).total).toBe(2);
    });

    it('searches every word, ignoring case and accents, and within one partition and type', async () => {
      const store = await seeded();
      expect(ids(await store.states.query({ ...base, terms: searchTerms('ORA') })).sort()).toEqual(['a1', 'a2', 'a4', 'a6', 'b7']);
      expect(ids(await store.states.query({ ...base, terms: searchTerms('óra terv') }))).toEqual(['a1']);
      expect(ids(await store.states.query({ ...base, terms: searchTerms('kor') })).sort()).toEqual(['a3', 'a5']);
      expect(ids(await store.states.query({ ...base, terms: searchTerms('nothing') }))).toEqual([]);
    });

    it('matches an id prefix only when asked', async () => {
      const store = await seeded();
      expect(ids(await store.states.query({ ...base, terms: ['b7'] }))).toEqual([]);
      expect(ids(await store.states.query({ ...base, terms: ['b7'], idPrefix: true }))).toEqual(['b7']);
    });

    it('leaves out hidden rows, and keeps first-write order without a sort', async () => {
      const store = await seeded();
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a1', streamVersion: 2 }), () => articles[0]![1], searchOf);
      expect(ids(await store.states.query({ ...base, hide: 'removed' }))).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b7']);
    });

    it('sorts text by code point, numbers numerically and booleans, empty values last both ways, ties by id', async () => {
      const store = await seeded();
      const q = (path: string, kind: 'text' | 'number' | 'boolean', descending = false) =>
        store.states.query({ ...base, hide: 'removed', sort: { path, kind, descending } });
      expect(ids(await q('title', 'text'))).toEqual(['a5', 'a3', 'b7', 'a2', 'a1', 'a4']);
      expect(ids(await q('title', 'text', true))).toEqual(['a1', 'a2', 'b7', 'a3', 'a5', 'a4']);
      expect(ids(await q('rank', 'number'))).toEqual(['a2', 'a3', 'b7', 'a1', 'a5', 'a4']);
      expect(ids(await q('rank', 'number', true))).toEqual(['a1', 'a5', 'a3', 'b7', 'a2', 'a4']);
      expect(ids(await q('top', 'boolean'))).toEqual(['a2', 'a5', 'b7', 'a1', 'a3', 'a4']);
    });

    it('sorts by a field of the referenced record, a missing or empty ref last', async () => {
      const store = await seeded();
      const page = await store.states.query({ ...base, hide: 'removed', sort: { path: 'section', kind: 'text', descending: false, ref: { streamType: 'section', path: 'title' } } });
      expect(ids(page)).toEqual(['a1', 'a5', 'a2', 'a4', 'a3', 'b7']);
    });

    it('pages by offset with the total of every match', async () => {
      const store = await seeded();
      const sort = { path: 'rank', kind: 'number' as const, descending: false };
      const page = await store.states.query({ ...base, hide: 'removed', sort, limit: 2, offset: 2 });
      expect(ids(page)).toEqual(['b7', 'a1']);
      expect(page.total).toBe(6);
      const searched = await store.states.query({ ...base, terms: searchTerms('ora'), limit: 1 });
      expect(searched.total).toBe(5);
    });

    it('walks every row exactly once by cursor, in the same order as one big page, for every sort', async () => {
      const store = await seeded();
      const sorts: Array<StateQuery['sort']> = [
        undefined,
        { path: 'title', kind: 'text', descending: false },
        { path: 'title', kind: 'text', descending: true },
        { path: 'rank', kind: 'number', descending: false },
        { path: 'rank', kind: 'number', descending: true },
        { path: 'top', kind: 'boolean', descending: false },
        { path: 'section', kind: 'text', descending: true, ref: { streamType: 'section', path: 'title' } },
      ];
      for (const sort of sorts) {
        const q = { ...base, ...(sort === undefined ? {} : { sort }) };
        const whole = ids(await store.states.query({ ...q, limit: 100 }));
        for (const size of [1, 2, 3]) expect(await walk(store, q, size)).toEqual(whole);
      }
    });

    it('skips the count when asked, giving the same rows', async () => {
      const store = await seeded();
      const sort = { path: 'rank', kind: 'number' as const, descending: false };
      const counted = await store.states.query({ ...base, sort, limit: 2, offset: 2 });
      const uncounted = await store.states.query({ ...base, sort, limit: 2, offset: 2, count: false });
      expect(uncounted.total).toBeUndefined();
      expect(uncounted.states).toEqual(counted.states);
    });

    it('gives no total on cursor pages, and an empty page after the last full one', async () => {
      const store = await seeded();
      const first = await store.states.query({ ...base, limit: 7 });
      expect(first.total).toBe(7);
      const second = await store.states.query({ ...base, limit: 7, after: first.next });
      expect(second).toEqual({ states: [], next: null });
    });

    it('filters by equals and notEquals on text, numbers and booleans, a missing value never equal (ADR 27)', async () => {
      const store = await seeded();
      const where = async (...conds: StateCondition[]) => ids(await store.states.query({ ...base, hide: 'removed', where: conds })).sort();
      expect(await where({ path: 'title', op: 'equals', value: 'ora' })).toEqual(['a2']);
      expect(await where({ path: 'rank', op: 'equals', value: 3 })).toEqual(['a1', 'a5']);
      expect(await where({ path: 'top', op: 'equals', value: true })).toEqual(['a1', 'a3']);
      expect(await where({ path: 'top', op: 'notEquals', value: true })).toEqual(['a2', 'a4', 'a5', 'b7']);
      expect(await where({ path: 'top', op: 'equals', value: false }, { path: 'rank', op: 'equals', value: 2 })).toEqual(['b7']);
    });

    it('filters by a prefix of a nested field, a missing value never starting with anything (ADR 27)', async () => {
      const store = await seeded();
      const where = async (op: StateCondition['op']) => ids(await store.states.query({ ...base, hide: 'removed', where: [{ path: 'file.contentType', op, value: 'image/' }] })).sort();
      expect(await where('startsWith')).toEqual(['a1']);
      expect(await where('notStartsWith')).toEqual(['a2', 'a3', 'a4', 'a5', 'b7']);
    });

    it('filters together with search, sort and paging, and counts only the matches', async () => {
      const store = await seeded();
      const page = await store.states.query({ ...base, terms: ['ora'], where: [{ path: 'top', op: 'notEquals', value: true }], sort: { path: 'title', kind: 'text', descending: false }, limit: 1 });
      expect(ids(page)).toEqual(['b7']);
      expect(page.total).toBe(3);
    });

    it('reads only the ids asked for', async () => {
      const store = await seeded();
      expect(ids(await store.states.query({ ...base, ids: ['a3', 'a1', 'zz'] })).sort()).toEqual(['a1', 'a3']);
      expect(ids(await store.states.query({ ...base, ids: [] }))).toEqual([]);
    });

    it('rebuilds search text with the states, and reports the states stale for other search fields', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a1' }), () => ({ title: 'Óra', body: 'zebra' }), (s) => searchTextOf(s, ['title']));
      await store.states.replaceStates(0, 'article', [{ streamId: 'a1', version: 1, state: { title: 'Óra', body: 'zebra' }, search: 'ora zebra' }], 'title,body');
      expect(await store.states.statesStale(0, 'article', 'title,body')).toBe(false);
      expect(await store.states.statesStale(0, 'article', 'title')).toBe(true);
      expect(ids(await store.states.query({ ...base, terms: ['zebra'] }))).toEqual(['a1']);
    });

    it('rewrites the search text with a rewritten state', async () => {
      const store = await freshStore();
      await store.states.appendWithState(input({ streamType: 'article', streamId: 'a1' }), () => ({ title: 'secret name' }), searchOf);
      await store.rewriteStreams(input({ streamType: '__erased', eventType: 'RecordRedacted' }), [
        { partitionId: 0, streamType: 'article', streamId: 'a1', expectedVersion: 1, payloads: new Map(), state: { title: null }, search: '' },
      ]);
      expect(ids(await store.states.query({ ...base, terms: ['secret'] }))).toEqual([]);
    });
  });

  describe(`PinStore contract: ${name}`, () => {
    const pins = (store: WithStates) => store.states.pins;
    it('queries the pinned versions like states, never the removed ones, sets kept apart', async () => {
      const store = await seeded();
      await pins(store).pin('published', 0, 'article', 'a1', 3, { title: 'Óra v1', rank: 1 }, searchTextOf({ title: 'Óra v1' }, fields));
      await pins(store).pin('published', 0, 'article', 'a2', 4, { title: 'Alma', rank: 2 }, searchTextOf({ title: 'Alma' }, fields));
      await pins(store).pin('draft', 0, 'article', 'a3', 5, { title: 'Draft' }, null);
      await pins(store).unpin('published', 0, 'article', 'a2');
      const page = await pins(store).query('published', { ...base });
      expect(page.states).toEqual([{ streamId: 'a1', version: 3, state: { title: 'Óra v1', rank: 1 } }]);
      expect(ids(await pins(store).query('published', { ...base, terms: ['ora'] }))).toEqual(['a1']);
      expect(ids(await pins(store).query('draft', { ...base }))).toEqual(['a3']);
    });

    it('sorts and pages pinned versions, and sorts them by a referenced record', async () => {
      const store = await seeded();
      for (const [i, [id, state]] of articles.entries()) await pins(store).pin('published', 0, 'article', id, i + 1, state, searchOf(state));
      const sort = { path: 'section', kind: 'text' as const, descending: false, ref: { streamType: 'section', path: 'title' } };
      expect(ids(await pins(store).query('published', { ...base, hide: 'removed', sort }))).toEqual(['a1', 'a5', 'a2', 'a4', 'a3', 'b7']);
      expect(await walk({ ...store, states: { ...store.states, query: (q) => pins(store).query('published', q) } }, { ...base, sort }, 2)).toEqual(
        ids(await pins(store).query('published', { ...base, sort })),
      );
    });

    it('feeds every pin and unpin in order, removed ones included, page by page', async () => {
      const store = await seeded();
      const s1 = await pins(store).pin('published', 0, 'article', 'a1', 3, { title: 'one' }, null);
      await pins(store).pin('published', 0, 'section', 's1', 4, { title: 'Hírek' }, null);
      await pins(store).pin('published', 0, 'article', 'a2', 5, { title: 'two' }, null);
      await pins(store).pin('published', 0, 'article', 'a1', 6, { title: 'one again' }, null);
      await pins(store).unpin('published', 0, 'article', 'a2');
      await pins(store).pin('draft', 0, 'article', 'a9', 7, { title: 'not in the feed' }, null);
      expect(await pins(store).unpin('published', 0, 'article', 'never')).toBeNull();
      const first = await pins(store).since('published', 0, s1, 2);
      expect(first.pins.map((p) => [p.streamType, p.streamId, p.removed])).toEqual([['section', 's1', false], ['article', 'a1', false]]);
      expect(first.pins[1]!.state).toEqual({ title: 'one again' });
      const second = await pins(store).since('published', 0, first.next!, 2);
      expect(second.pins.map((p) => [p.streamId, p.removed, p.state])).toEqual([['a2', true, null]]);
      expect(second.next).toBeNull();
      expect(await pins(store).pinsOf(0, 'article', 'a1')).toEqual([{ set: 'published', position: 6 }]);
    });

    it('unpins a deleted stream and rewrites a redacted stream\'s pinned version, in the erasure itself', async () => {
      const store = await seeded();
      const s0 = await pins(store).pin('published', 0, 'article', 'a1', 1, { title: 'Óra terv', secret: 'x' }, 'ora terv');
      await pins(store).pin('published', 0, 'article', 'a2', 1, { title: 'ora' }, 'ora');
      const rewrite = { partitionId: 0, streamType: 'article', expectedVersion: 1 };
      await store.rewriteStreams(input({ streamType: '__erased', eventType: 'RecordRedacted' }), [
        { ...rewrite, streamId: 'a1', payloads: new Map(), state: { title: 'Óra terv', secret: null }, search: 'ora terv', pins: [{ set: 'published', state: { title: 'Óra terv', secret: null }, search: 'ora terv' }] },
      ]);
      await store.rewriteStreams(input({ streamType: '__erased', streamVersion: 2, eventType: 'RecordErased' }), [{ ...rewrite, streamId: 'a2', payloads: null }]);
      expect((await pins(store).query('published', { ...base })).states).toEqual([{ streamId: 'a1', version: 1, state: { title: 'Óra terv', secret: null } }]);
      const feed = await pins(store).since('published', 0, s0, 10);
      expect(feed.pins.map((p) => [p.streamId, p.removed])).toEqual([['a1', false], ['a2', true]]);
    });
  });
}

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

// The behaviour the engine relies on from every BlobStore: content addressed, idempotent, first content type wins.
export function describeBlobStore(
  { describe, it, expect }: TestApi,
  name: string,
  freshStore: () => BlobStore | Promise<BlobStore>,
): void {
  describe(`BlobStore contract: ${name}`, () => {
    it('keys the bytes by their sha256 and reports their size', async () => {
      const store = await freshStore();
      expect(await store.putBlob(enc('hello'), 'image/png')).toEqual({ hash: HELLO_SHA, size: 5 });
      expect(await store.hasBlob(HELLO_SHA)).toBe(true);
    });

    it('gives different bytes different hashes', async () => {
      const store = await freshStore();
      expect((await store.putBlob(enc('a'))).hash).not.toBe((await store.putBlob(enc('b'))).hash);
    });

    it('round-trips the bytes and content type', async () => {
      const store = await freshStore();
      await store.putBlob(enc('hello'), 'image/png');
      const got = await store.getBlob(HELLO_SHA);
      expect(new TextDecoder().decode(got?.bytes)).toBe('hello');
      expect(got?.contentType).toBe('image/png');
    });

    it('round-trips every byte value losslessly', async () => {
      const store = await freshStore();
      const bytes = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
      const { hash } = await store.putBlob(bytes, 'application/octet-stream');
      expect(Array.from((await store.getBlob(hash))?.bytes ?? [])).toEqual(Array.from(bytes));
    });

    it('stores an omitted content type as null', async () => {
      const store = await freshStore();
      const { hash } = await store.putBlob(enc('x'));
      expect((await store.getBlob(hash))?.contentType).toBeNull();
    });

    it('is idempotent and keeps the first content type', async () => {
      const store = await freshStore();
      await store.putBlob(enc('hello'), 'image/png');
      expect(await store.putBlob(enc('hello'), 'text/plain')).toEqual({ hash: HELLO_SHA, size: 5 });
      expect((await store.getBlob(HELLO_SHA))?.contentType).toBe('image/png');
    });

    it('knows nothing of a hash it was never given', async () => {
      const store = await freshStore();
      expect(await store.getBlob(HELLO_SHA)).toBeNull();
      expect(await store.hasBlob(HELLO_SHA)).toBe(false);
    });
  });
}
