import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { createPgEventStore, type EventStoreDatabase } from './store.js';

describe('createPgEventStore', () => {
  it('returns an EventStore exposing the StoragePort methods', () => {
    const store = createPgEventStore({} as Kysely<EventStoreDatabase>);
    expect(typeof store.append).toBe('function');
    expect(typeof store.findByStream).toBe('function');
    expect(typeof store.findByStreamType).toBe('function');
    expect(typeof store.streamHead).toBe('function');
  });
});
