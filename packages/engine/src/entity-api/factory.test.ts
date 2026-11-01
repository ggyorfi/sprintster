import { describe, it, expect } from 'vitest';
import { createEntityApi, type Reducer } from './factory.js';
import { InMemoryEventStore } from '../events/store.js';

interface Counter {
  id: string;
  value: number;
  removed: boolean;
}

const counterReducer: Reducer<Counter> = (state, event) => {
  switch (event.eventType) {
    case 'Created': {
      const p = event.payload as { id: string };
      return { id: p.id, value: 0, removed: false };
    }
    case 'Incremented': {
      if (state === null || state.removed) return state;
      const p = event.payload as { by: number };
      return { ...state, value: state.value + p.by };
    }
    case 'Removed': {
      if (state === null) return null;
      return { ...state, removed: true };
    }
    default:
      return state;
  }
};

function buildApi() {
  const store = new InMemoryEventStore();
  const api = createEntityApi(store, {
    partitionId: 0,
    streamType: 'counter',
    reducer: counterReducer,
  });
  return { store, api };
}

describe('createEntityApi', () => {
  it('findOneById returns null when no events exist', async () => {
    const { api } = buildApi();
    expect(await api.findOneById('a')).toBeNull();
  });

  it('createEvent appends the first event and returns the folded state', async () => {
    const { api } = buildApi();
    const state = await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    expect(state).toEqual({ id: 'a', value: 0, removed: false });
  });

  it('createEvent appends with monotonic stream_version', async () => {
    const { store, api } = buildApi();
    await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    await api.createEvent('a', () => ({
      eventType: 'Incremented',
      eventVersion: 1,
      payload: { by: 5 },
      actor: 'tester',
    }));
    const events = await store.findByStream(0, 'counter', 'a');
    expect(events.map((e) => e.streamVersion)).toEqual([1, 2]);
  });

  it('createEvent folds subsequent events on top', async () => {
    const { api } = buildApi();
    await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    const next = await api.createEvent('a', () => ({
      eventType: 'Incremented',
      eventVersion: 1,
      payload: { by: 7 },
      actor: 'tester',
    }));
    expect(next).toEqual({ id: 'a', value: 7, removed: false });
  });

  it('build callback receives current state for validation', async () => {
    const { api } = buildApi();
    await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    await expect(
      api.createEvent('a', (state) => {
        if (state !== null) throw new Error('already exists');
        return {
          eventType: 'Created',
          eventVersion: 1,
          payload: { id: 'a' },
          actor: 'tester',
        };
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('findMany returns all live entities of the stream type', async () => {
    const { api } = buildApi();
    await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    await api.createEvent('b', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'b' },
      actor: 'tester',
    }));
    await api.createEvent('a', () => ({
      eventType: 'Incremented',
      eventVersion: 1,
      payload: { by: 3 },
      actor: 'tester',
    }));
    const all = await api.findMany();
    expect(all).toHaveLength(2);
    const a = all.find((c) => c.id === 'a');
    const b = all.find((c) => c.id === 'b');
    expect(a?.value).toBe(3);
    expect(b?.value).toBe(0);
  });

  it('findMany excludes streams whose reducer terminated as null', async () => {
    const removedReducer: Reducer<Counter> = (state, event) => {
      if (event.eventType === 'Created') {
        const p = event.payload as { id: string };
        return { id: p.id, value: 0, removed: false };
      }
      if (event.eventType === 'Removed') return null;
      return state;
    };
    const store = new InMemoryEventStore();
    const api = createEntityApi(store, {
      partitionId: 0,
      streamType: 'counter',
      reducer: removedReducer,
    });
    await api.createEvent('a', () => ({
      eventType: 'Created',
      eventVersion: 1,
      payload: { id: 'a' },
      actor: 'tester',
    }));
    expect((await api.findMany()).length).toBe(1);
    await store.append({
      partitionId: 0,
      streamType: 'counter',
      streamId: 'a',
      streamVersion: 2,
      eventType: 'Removed',
      eventVersion: 1,
      payload: {},
      occurredAt: new Date().toISOString(),
      actor: 'tester',
      correlationId: null,
    });
    // An append that bypasses the api leaves the stored states behind the log until they are rebuilt.
    expect((await api.findMany()).length).toBe(1);
    await api.rebuildStates();
    expect((await api.findMany()).length).toBe(0);
  });

  it('rebuilds stale states once, before the first read', async () => {
    const store = new InMemoryEventStore();
    const event = (version: number, eventType: string) => ({
      partitionId: 0,
      streamType: 'counter',
      streamId: 'a',
      streamVersion: version,
      eventType,
      eventVersion: 1,
      payload: { id: 'a', by: 5 },
      occurredAt: new Date().toISOString(),
      actor: 'tester',
      correlationId: null,
    });
    await store.append(event(1, 'Created'));
    await store.append(event(2, 'Incremented'));
    const api = createEntityApi(store, { partitionId: 0, streamType: 'counter', reducer: counterReducer });
    expect(await api.findOneById('a')).toMatchObject({ value: 5 });
    expect(await store.states.getState(0, 'counter', 'a')).toMatchObject({ version: 2 });
  });

  it('appends nothing when the reducer refuses the event', async () => {
    const store = new InMemoryEventStore();
    const api = createEntityApi(store, { partitionId: 0, streamType: 'counter', reducer: () => null });
    await expect(
      api.createEvent('a', () => ({ eventType: 'Created', eventVersion: 1, payload: { id: 'a' }, actor: 'tester' })),
    ).rejects.toThrow(/reducer returned null/);
    expect(await store.findByStream(0, 'counter', 'a')).toEqual([]);
  });
});
