import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { UniqueViolationError, type EventInput } from '@sprintster/engine';
import { createSqliteEventStore } from './store.js';

function evt(o: { streamId: string; streamVersion: number; payload?: unknown; streamType?: string }): EventInput {
  return {
    partitionId: 0,
    streamType: o.streamType ?? 'thing',
    streamId: o.streamId,
    streamVersion: o.streamVersion,
    eventType: 'ThingAdded',
    eventVersion: 1,
    payload: o.payload ?? {},
    occurredAt: '2026-01-01T00:00:00.000Z',
    actor: 'test',
    correlationId: null,
  };
}

function freshStore() {
  return createSqliteEventStore(new Database(':memory:'));
}

describe('createSqliteEventStore', () => {
  it('appends and reads a stream back in version order with parsed payload', async () => {
    const store = freshStore();
    await store.append(evt({ streamId: 's1', streamVersion: 1, payload: { a: 1 } }));
    await store.append(evt({ streamId: 's1', streamVersion: 2, payload: { a: 2 } }));
    const rows = await store.findByStream(0, 'thing', 's1');
    expect(rows.map((r) => r.streamVersion)).toEqual([1, 2]);
    expect(rows[0]?.payload).toEqual({ a: 1 });
    expect(rows[0]?.id).toBeTypeOf('string');
  });

  it('rejects a duplicate (partition, streamType, streamId, version) with UniqueViolationError', async () => {
    const store = freshStore();
    await store.append(evt({ streamId: 's1', streamVersion: 1 }));
    await expect(store.append(evt({ streamId: 's1', streamVersion: 1 }))).rejects.toBeInstanceOf(
      UniqueViolationError,
    );
  });

  it('streamHead returns the max version, 0 when empty', async () => {
    const store = freshStore();
    expect(await store.streamHead(0, 'thing', 's1')).toBe(0);
    await store.append(evt({ streamId: 's1', streamVersion: 1 }));
    await store.append(evt({ streamId: 's1', streamVersion: 5 }));
    expect(await store.streamHead(0, 'thing', 's1')).toBe(5);
  });

  it('findByStreamType returns every stream of a type in insertion order', async () => {
    const store = freshStore();
    await store.append(evt({ streamId: 'a', streamVersion: 1 }));
    await store.append(evt({ streamId: 'b', streamVersion: 1 }));
    await store.append(evt({ streamId: 'a', streamVersion: 2 }));
    const rows = await store.findByStreamType(0, 'thing');
    expect(rows.map((r) => r.streamId)).toEqual(['a', 'b', 'a']);
  });
});
