import { ConcurrencyError } from '../errors/api-error.js';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
  type StateStore,
} from '../events/store.js';
import { evaluateQuery, searchTextOf, type EvaluatedRow, type StatePage, type StateQuery } from '../events/query.js';

export type Reducer<State> = (state: State | null, event: EventRow) => State | null;

export interface EntityApiConfig<State> {
  partitionId: number;
  streamType: string;
  reducer: Reducer<State>;
  maxRetries?: number;
  // False for a stored state the current reducer would not produce, so the states are refolded before the first read.
  isCurrent?: (state: unknown) => boolean;
  // ADR 24: the properties a state's search text is made of.
  searchFields?: readonly string[];
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
  // ADR 21: each stream folded from its events up to `positionOf(streamId)`; a stream with none that early is left out.
  findManyAt(positionOf: (streamId: string) => number): Promise<State[]>;
  createEvent(streamId: string, build: (state: State | null) => ApplyEventInput): Promise<State>;
  // Refolds every stream from the log into the store's states; a no-op for a store without them.
  rebuildStates(): Promise<void>;
  // ADR 24: one page, from the store when it keeps states.
  query(q: Omit<StateQuery, 'partitionId' | 'streamType'>): Promise<StatePage>;
  // ADR 26: the state as of a position, null when the stream had no event by then.
  foldAt(streamId: string, position: number): Promise<{ state: State | null; version: number }>;
  searchText(state: unknown): string | null;
}

export function createEntityApi<State>(
  store: EventStore,
  config: EntityApiConfig<State>,
): EntityApi<State> {
  const { partitionId, streamType, reducer } = config;
  const maxRetries = config.maxRetries ?? 5;

  const states = store.states;
  let checked: Promise<void> | undefined;
  const searchFields = [...new Set(config.searchFields ?? [])].sort();
  const searchKey = searchFields.join(',');
  const searchText = (state: unknown) => searchTextOf(state, searchFields);

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

  async function findManyAt(positionOf: (streamId: string) => number): Promise<State[]> {
    const byStream = new Map<string, EventRow[]>();
    for (const e of await store.findByStreamType(partitionId, streamType)) {
      if (Number(e.id) > positionOf(e.streamId)) continue;
      const arr = byStream.get(e.streamId);
      if (arr === undefined) byStream.set(e.streamId, [e]);
      else arr.push(e);
    }
    const out: State[] = [];
    for (const list of byStream.values()) {
      list.sort((a, b) => a.streamVersion - b.streamVersion);
      let s: State | null = null;
      for (const e of list) s = reducer(s, e);
      if (s !== null) out.push(s);
    }
    return out;
  }

  async function rebuildStates(): Promise<void> {
    if (states === undefined) return;
    const all = await foldAll();
    await states.replaceStates(
      partitionId,
      streamType,
      [...all].map(([streamId, { state, version }]) => ({ streamId, version, state, search: searchText(state) })),
      searchKey,
    );
  }

  // Once per api: states written before this version, or by a writer that bypassed them, are rebuilt before the first read.
  function ensureStates(s: StateStore): Promise<void> {
    const outdated = async () =>
      config.isCurrent !== undefined && (await s.listStates(partitionId, streamType)).some(({ state }) => !config.isCurrent!(state));
    const verify = async () => {
      if (await s.statesVerified(partitionId, streamType, searchKey)) return;
      if ((await s.statesStale(partitionId, streamType, searchKey)) || (await outdated())) await rebuildStates();
    };
    checked ??= verify().catch((err: unknown) => {
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
        await states.appendWithState(input, (row) => (next = apply(row)), searchText);
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

  async function query(q: Omit<StateQuery, 'partitionId' | 'streamType'>): Promise<StatePage> {
    const full = { ...q, partitionId, streamType };
    if (states !== undefined) {
      await ensureStates(states);
      return states.query(full);
    }
    const rows: EvaluatedRow[] = [...(await foldAll())].flatMap(([streamId, { state, version }], seq) =>
      state === null ? [] : [{ streamId, version, state, search: searchText(state), seq }],
    );
    return evaluateQuery(rows, full, () => undefined);
  }

  async function foldAt(streamId: string, position: number): Promise<{ state: State | null; version: number }> {
    let state: State | null = null;
    let version = 0;
    for (const e of await store.findByStream(partitionId, streamType, streamId)) {
      if (Number(e.id) > position) break;
      state = reducer(state, e);
      version = e.streamVersion;
    }
    return { state, version };
  }

  return { findOneById, findMany, findManyAt, createEvent, rebuildStates, query, foldAt, searchText };
}
