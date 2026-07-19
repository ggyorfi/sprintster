import { describe, it, expect } from 'vitest';
import { InMemoryEventStore, UniqueViolationError, type EventInput } from './store.js';

function makeInput(overrides: Partial<EventInput> = {}): EventInput {
  return {
    partitionId: 0,
    streamType: 'client',
    streamId: 'GRA-A26',
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

describe('InMemoryEventStore', () => {
  it('appends an event and returns it with an id and recordedAt', async () => {
    const store = new InMemoryEventStore();
    const row = await store.append(makeInput());
    expect(row.id).toBe('1');
    expect(row.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('assigns increasing ids across appends', async () => {
    const store = new InMemoryEventStore();
    const a = await store.append(makeInput({ streamVersion: 1 }));
    const b = await store.append(makeInput({ streamVersion: 2 }));
    expect(a.id).toBe('1');
    expect(b.id).toBe('2');
  });

  it('rejects duplicate (partition, streamType, streamId, streamVersion)', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeInput({ streamVersion: 1 }));
    await expect(store.append(makeInput({ streamVersion: 1 }))).rejects.toBeInstanceOf(UniqueViolationError);
  });

  it('allows same streamVersion across different streams', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeInput({ streamId: 'A', streamVersion: 1 }));
    await store.append(makeInput({ streamId: 'B', streamVersion: 1 }));
    const a = await store.findByStream(0, 'client', 'A');
    const b = await store.findByStream(0, 'client', 'B');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('findByStream returns events for one stream in stream_version order', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeInput({ streamVersion: 2, payload: { v: 2 } }));
    await store.append(makeInput({ streamVersion: 1, payload: { v: 1 } }));
    const rows = await store.findByStream(0, 'client', 'GRA-A26');
    expect(rows.map((r) => r.streamVersion)).toEqual([1, 2]);
  });

  it('findByStreamType returns events across streams of one type', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeInput({ streamId: 'A' }));
    await store.append(makeInput({ streamId: 'B' }));
    await store.append(makeInput({ streamType: 'invoice', streamId: 'X' }));
    const clients = await store.findByStreamType(0, 'client');
    expect(clients.map((r) => r.streamId).sort()).toEqual(['A', 'B']);
  });

  it('findByStreamType isolates partitions', async () => {
    const store = new InMemoryEventStore();
    await store.append(makeInput({ partitionId: 0, streamId: 'A' }));
    await store.append(makeInput({ partitionId: 1, streamId: 'A' }));
    expect((await store.findByStreamType(0, 'client'))).toHaveLength(1);
    expect((await store.findByStreamType(1, 'client'))).toHaveLength(1);
  });
});
