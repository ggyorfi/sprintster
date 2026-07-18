import { describe, it, expect } from 'vitest';
import { changedFields, deepEqual, planUpdate, applyUpdate, type FieldEventBuilder } from './diff.js';
import { createEntityApi } from '../entity-api/factory.js';
import { InMemoryEventStore } from '../events/store.js';
import type { Reducer } from '../entity-api/factory.js';

interface Thing {
  id: string;
  name: string;
  count: number;
  tags: { a: string | null };
  removed: boolean;
}

describe('deepEqual', () => {
  it('compares primitives, nulls, arrays and nested objects', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });
});

describe('changedFields', () => {
  const current: Thing = { id: '1', name: 'A', count: 1, tags: { a: 'x' }, removed: false };

  it('reports only patch keys whose value differs', () => {
    const changed = changedFields(current, { name: 'B', count: 1 });
    expect([...changed]).toEqual(['name']);
  });

  it('treats a deep-equal object value as unchanged', () => {
    const changed = changedFields(current, { tags: { a: 'x' } });
    expect(changed.size).toBe(0);
  });

  it('detects a changed nested object value', () => {
    const changed = changedFields(current, { tags: { a: 'y' } });
    expect([...changed]).toEqual(['tags']);
  });
});

const fieldName = (payload: unknown): unknown => (payload as Record<string, unknown>)['field'];

describe('planUpdate', () => {
  const current: Thing = { id: '1', name: 'A', count: 1, tags: { a: 'x' }, removed: false };
  const build: FieldEventBuilder<Thing> = (id, field, value) => ({
    eventType: 'FieldChanged',
    eventVersion: 1,
    payload: { id, field, value },
  });

  it('emits one event per changed field (in patch key order)', () => {
    const events = planUpdate('1', current, { name: 'B', count: 2 }, build);
    expect(events.map((e) => fieldName(e.payload))).toEqual(['name', 'count']);
  });

  it('emits nothing when no value actually changes (no-op suppression)', () => {
    expect(planUpdate('1', current, { name: 'A', count: 1 }, build)).toEqual([]);
  });

  it('carries the new value for each changed field', () => {
    const events = planUpdate('1', current, { name: 'B' }, build);
    expect(events[0]?.payload).toEqual({ id: '1', field: 'name', value: 'B' });
  });

  it('suppresses a deep-equal object value and detects a changed one', () => {
    expect(planUpdate('1', current, { tags: { a: 'x' } }, build)).toEqual([]);
    expect(planUpdate('1', current, { tags: { a: 'y' } }, build).map((e) => fieldName(e.payload))).toEqual(['tags']);
  });
});

describe('applyUpdate', () => {
  type State = { id: string; name: string; count: number; removed: boolean };
  const reducer: Reducer<State> = (state, event) => {
    const p = event.payload as Record<string, unknown>;
    switch (event.eventType) {
      case 'Created':
        return { id: p['id'] as string, name: p['name'] as string, count: 0, removed: false };
      case 'FieldChanged':
        return state === null ? null : ({ ...state, [p['field'] as string]: p['value'] } as State);
      default:
        return state;
    }
  };
  const build: FieldEventBuilder<State> = (id, field, value) => ({
    eventType: 'FieldChanged',
    eventVersion: 1,
    payload: { id, field, value },
  });
  const assertWritable = (s: State | null): State => {
    if (s === null) throw new Error('not found');
    if (s.removed) throw new Error('removed');
    return s;
  };

  function setup() {
    const store = new InMemoryEventStore();
    const base = createEntityApi<State>(store, { partitionId: 0, streamType: 'thing', reducer });
    return { store, base };
  }

  it('appends one event per changed field and returns final state', async () => {
    const { store, base } = setup();
    await base.createEvent('1', () => ({ eventType: 'Created', eventVersion: 1, payload: { id: '1', name: 'A' }, actor: 'me' }));
    const out = await applyUpdate(base, '1', { name: 'B', count: 5 }, { build, actor: 'me', assertWritable });
    expect(out).toMatchObject({ name: 'B', count: 5 });
    const events = await store.findByStream(0, 'thing', '1');
    expect(events.map((e) => e.eventType)).toEqual(['Created', 'FieldChanged', 'FieldChanged']);
  });

  it('appends nothing for a no-op update', async () => {
    const { store, base } = setup();
    await base.createEvent('1', () => ({ eventType: 'Created', eventVersion: 1, payload: { id: '1', name: 'A' }, actor: 'me' }));
    await applyUpdate(base, '1', { name: 'A' }, { build, actor: 'me', assertWritable });
    expect((await store.findByStream(0, 'thing', '1')).length).toBe(1);
  });

  it('enforces the writable policy', async () => {
    const { base } = setup();
    await expect(applyUpdate(base, 'missing', { name: 'B' }, { build, actor: 'me', assertWritable })).rejects.toThrow(
      /not found/,
    );
  });
});
