import { ConcurrencyError } from '../errors/api-error.js';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
  type StateStore,
} from '../events/store.js';

export type Reducer<State> = (state: State | null, event: EventRow) => State | null;

export interface EntityApiConfig<State> {
  partitionId: number;
  streamType: string;
  reducer: Reducer<State>;
  maxRetries?: number;
}

export interface ApplyEventInput {
  eventType: string;
  eventVersion: number;
  payload: unknown;
  actor: string;
  occurredAt?: string;
  correlationId?: string | null;
}

export interface EntityApi<State> {
  findOneById(streamId: string): Promise<State | null>;
  findMany(): Promise<State[]>;
  createEvent(streamId: string, build: (state: State | null) => ApplyEventInput): Promise<State>;
  // Refolds every stream from the log into the store's states; a no-op for a store without them.
  rebuildStates(): Promise<void>;
}

export function createEntityApi<State>(
  store: EventStore,
  config: EntityApiConfig<State>,
): EntityApi<State> {
  const { partitionId, streamType, reducer } = config;
  const maxRetries = config.maxRetries ?? 5;

  const states = store.states;
  let checked: Promise<void> | undefined;

  async function foldStream(streamId: string): Promise<{ state: State | null; version: number }> {
    const events = await store.findByStream(partitionId, streamType, streamId);
    let state: State | null = null;
    for (const e of events) state = reducer(state, e);
    return { state, version: events.length };
  }

  // Every stream of the type, in order of its first event.
  async function foldAll(): Promise<Map<string, { state: State | null; version: number }>> {
    const events = await store.findByStreamType(partitionId, streamType);
    const byStream = new Map<string, EventRow[]>();
    for (const e of events) {
      const arr = byStream.get(e.streamId);
      if (arr === undefined) byStream.set(e.streamId, [e]);
      else arr.push(e);
    }
    const out = new Map<string, { state: State | null; version: number }>();
    for (const [streamId, list] of byStream) {
      list.sort((a, b) => a.streamVersion - b.streamVersion);
      let s: State | null = null;
      for (const e of list) s = reducer(s, e);
      out.set(streamId, { state: s, version: list[list.length - 1]?.streamVersion ?? 0 });
    }
    return out;
  }

  async function rebuildStates(): Promise<void> {
    if (states === undefined) return;
    const all = await foldAll();
    await states.replaceStates(
      partitionId,
      streamType,
      [...all].map(([streamId, { state, version }]) => ({ streamId, version, state })),
    );
  }

  // Once per api: states written before this version, or by a writer that bypassed them, are rebuilt before the first read.
  function ensureStates(s: StateStore): Promise<void> {
    checked ??= s
      .statesStale(partitionId, streamType)
      .then((stale) => (stale ? rebuildStates() : undefined))
      .catch((err: unknown) => {
        checked = undefined;
        throw err;
      });
    return checked;
  }

  async function current(streamId: string): Promise<{ state: State | null; version: number }> {
    if (states === undefined) return foldStream(streamId);
    await ensureStates(states);
    const stored = await states.getState(partitionId, streamType, streamId);
    return stored === null ? { state: null, version: 0 } : { state: stored.state as State | null, version: stored.version };
  }

  async function findOneById(streamId: string): Promise<State | null> {
    return (await current(streamId)).state;
  }

  async function findMany(): Promise<State[]> {
    if (states === undefined) {
      return [...(await foldAll()).values()].flatMap(({ state }) => (state === null ? [] : [state]));
    }
    await ensureStates(states);
    return (await states.listStates(partitionId, streamType)).flatMap(({ state }) =>
      state === null ? [] : [state as State],
    );
  }

  async function createEvent(
    streamId: string,
    build: (state: State | null) => ApplyEventInput,
  ): Promise<State> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { state, version } = await current(streamId);
      const built = build(state);
      const input: EventInput = {
        partitionId,
        streamType,
        streamId,
        streamVersion: version + 1,
        eventType: built.eventType,
        eventVersion: built.eventVersion,
        payload: built.payload,
        occurredAt: built.occurredAt ?? new Date().toISOString(),
        actor: built.actor,
        correlationId: built.correlationId ?? null,
      };
      const apply = (row: EventRow): State => {
        const next = reducer(state, row);
        if (next === null) {
          throw new Error(
            `reducer returned null after applying ${built.eventType}; entity removed but expected a state`,
          );
        }
        return next;
      };
      try {
        if (states === undefined) return apply(await store.append(input));
        let next: State | undefined;
        await states.appendWithState(input, (row) => (next = apply(row)));
        return next as State;
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new ConcurrencyError(
      `OCC retry limit reached for ${streamType}/${streamId} after ${maxRetries} attempts: ${String(lastErr)}`,
    );
  }

  return { findOneById, findMany, createEvent, rebuildStates };
}
