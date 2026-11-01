import type * as Vitest from 'vitest';
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
