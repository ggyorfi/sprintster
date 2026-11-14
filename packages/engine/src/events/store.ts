import { evaluateQuery, type EvaluatedRow, type PinRow, type PinStore, type StatePage, type StateQuery } from './query.js';

// Default actor for events with no authenticated user (there is no auth yet, so every daemon write falls back to this).
export const SYSTEM_ACTOR = 'system';

export interface EventInput {
  partitionId: number;
  streamType: string;
  streamId: string;
  streamVersion: number;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  occurredAt: string;
  actor: string;
  correlationId: string | null;
}

export interface EventRow extends EventInput {
  id: string;
  recordedAt: string;
}

export class UniqueViolationError extends Error {
  constructor(message = 'stream version already exists') {
    super(message);
    this.name = 'UniqueViolationError';
  }
}

// A stream's state after its latest event, as the engine's reducer produced it.
export interface StoredState {
  streamId: string;
  version: number;
  state: unknown;
  // ADR 24: written beside the state for searching; never read back.
  search?: string | null;
}

// Current state per stream, derived from the log and rebuildable from it. A store that offers it lets reads skip folding events.
export interface StateStore {
  // Appends the event and records `project(row)` as the stream's state in one transaction; a throw from `project` appends nothing.
  // `searchOf` gives the state's search text (ADR 24).
  appendWithState(input: EventInput, project: (row: EventRow) => unknown, searchOf?: (state: unknown) => string | null): Promise<EventRow>;
  getState(partitionId: number, streamType: string, streamId: string): Promise<StoredState | null>;
  // In order of each stream's first event.
  listStates(partitionId: number, streamType: string): Promise<StoredState[]>;
  // True when some stream's stored version differs from its latest event, as after an upgrade or a write that bypassed the
  // states, or when the search text was written for other search fields than `searchKey` names.
  statesStale(partitionId: number, streamType: string, searchKey?: string): Promise<boolean>;
  replaceStates(partitionId: number, streamType: string, states: readonly StoredState[], searchKey?: string): Promise<void>;
  // ADR 24: one page, chosen and ordered by the store.
  query(q: StateQuery): Promise<StatePage>;
  // ADR 26.
  pins: PinStore;
}

// One stream's part of an erasure (ADR 18).
export interface StreamRewrite {
  partitionId: number;
  streamType: string;
  streamId: string;
  // The stream's head when the rewrite was planned; any other head refuses the whole call.
  expectedVersion: number;
  // New payloads by event id, or null to delete the stream's events and state.
  payloads: ReadonlyMap<string, unknown> | null;
  // The stream's state after new payloads, for a store that keeps states.
  state?: unknown;
  search?: string | null;
  // The stream's pinned snapshots after new payloads (ADR 26); deleting the stream unpins them.
  pins?: ReadonlyArray<{ set: string; state: unknown; search: string | null }>;
}

export interface EventStore {
  append(input: EventInput): Promise<EventRow>;
  findByStream(
    partitionId: number,
    streamType: string,
    streamId: string,
  ): Promise<EventRow[]>;
  findByStreamType(
    partitionId: number,
    streamType: string,
  ): Promise<EventRow[]>;
  // Highest stream_version of a stream (0 if empty); the O(1) read the sequence allocator needs.
  streamHead(
    partitionId: number,
    streamType: string,
    streamId: string,
  ): Promise<number>;
  // The log's position: the id of its latest event, 0 when empty. It only grows.
  position(): Promise<number>;
  // Every event after a position, in log order.
  findSince(position: number): Promise<EventRow[]>;
  // One transaction: appends `marker` first, so the position still only grows, then applies every rewrite. A head that moved throws UniqueViolationError.
  rewriteStreams(marker: EventInput, rewrites: readonly StreamRewrite[]): Promise<EventRow>;
  states?: StateStore;
}

interface MemoryState {
  streamId: string;
  version: number;
  state: unknown;
  search: string | null;
  seq: number;
}

interface MemoryPin {
  set: string;
  partitionId: number;
  streamType: string;
  streamId: string;
  position: number;
  state: unknown;
  search: string | null;
  removed: boolean;
  seq: number;
  firstSeq: number;
}

export class InMemoryEventStore implements EventStore {
  private rows: EventRow[] = [];
  private nextId = 1;
  private stateMap = new Map<string, Map<string, MemoryState>>();
  private searchKeys = new Map<string, string>();
  private stateSeq = 0;
  private pinMap = new Map<string, MemoryPin>();
  private pinSeq = 0;

  private putState(partitionId: number, streamType: string, streamId: string, version: number, state: unknown, search: string | null): void {
    const states = this.statesOf(partitionId, streamType);
    const seq = states.get(streamId)?.seq ?? ++this.stateSeq;
    states.set(streamId, { streamId, version, state, search, seq });
  }

  private evaluate(rows: EvaluatedRow[], q: StateQuery): StatePage {
    return evaluateQuery(rows, q, (type, id) => this.statesOf(q.partitionId, type).get(id)?.state);
  }

  private pinKey = (set: string, partitionId: number, streamType: string, streamId: string) => `${set}\0${partitionId}\0${streamType}\0${streamId}`;

  readonly states: StateStore = {
    appendWithState: async (input, project, searchOf) => {
      const row = await this.append(input);
      try {
        const state = project(row);
        this.putState(input.partitionId, input.streamType, input.streamId, input.streamVersion, state, searchOf?.(state) ?? null);
      } catch (err) {
        this.rows.splice(this.rows.indexOf(row), 1);
        throw err;
      }
      return row;
    },
    getState: async (partitionId, streamType, streamId) => {
      const s = this.statesOf(partitionId, streamType).get(streamId);
      return s === undefined ? null : { streamId: s.streamId, version: s.version, state: s.state };
    },
    listStates: async (partitionId, streamType) =>
      [...this.statesOf(partitionId, streamType).values()].sort((a, b) => a.seq - b.seq).map((s) => ({ streamId: s.streamId, version: s.version, state: s.state })),
    query: async (q) => this.evaluate([...this.statesOf(q.partitionId, q.streamType).values()], q),
    pins: {
      pin: async (set, partitionId, streamType, streamId, position, state, search) => {
        const seq = ++this.pinSeq;
        const key = this.pinKey(set, partitionId, streamType, streamId);
        const firstSeq = this.pinMap.get(key)?.firstSeq ?? seq;
        this.pinMap.set(key, { set, partitionId, streamType, streamId, position, state, search, removed: false, seq, firstSeq });
        return seq;
      },
      unpin: async (set, partitionId, streamType, streamId) => {
        const key = this.pinKey(set, partitionId, streamType, streamId);
        const pin = this.pinMap.get(key);
        if (pin === undefined || pin.removed) return null;
        const seq = ++this.pinSeq;
        this.pinMap.set(key, { ...pin, state: null, search: null, removed: true, seq });
        return seq;
      },
      query: async (set, q) =>
        this.evaluate(
          [...this.pinMap.values()]
            .filter((p) => p.set === set && p.partitionId === q.partitionId && p.streamType === q.streamType && !p.removed)
            .map((p) => ({ streamId: p.streamId, version: p.position, state: p.state, search: p.search, seq: p.firstSeq })),
          q,
        ),
      since: async (set, partitionId, afterSeq, limit) => {
        const all = [...this.pinMap.values()].filter((p) => p.set === set && p.partitionId === partitionId && p.seq > afterSeq).sort((a, b) => a.seq - b.seq);
        const pins: PinRow[] = all.slice(0, limit).map((p) => ({ set: p.set, streamType: p.streamType, streamId: p.streamId, position: p.position, state: p.state, removed: p.removed, seq: p.seq }));
        return { pins, next: pins.length === limit ? pins.at(-1)!.seq : null };
      },
      pinsOf: async (partitionId, streamType, streamId) =>
        [...this.pinMap.values()]
          .filter((p) => p.partitionId === partitionId && p.streamType === streamType && p.streamId === streamId && !p.removed)
          .map((p) => ({ set: p.set, position: p.position })),
    },
    statesStale: async (partitionId, streamType, searchKey) => {
      if (searchKey !== undefined && this.statesOf(partitionId, streamType).size > 0 && this.searchKeys.get(`${partitionId}\0${streamType}`) !== searchKey) return true;
      const states = this.statesOf(partitionId, streamType);
      const heads = new Map<string, number>();
      for (const r of this.rows) {
        if (r.partitionId === partitionId && r.streamType === streamType) {
          heads.set(r.streamId, Math.max(heads.get(r.streamId) ?? 0, r.streamVersion));
        }
      }
      return [...heads].some(([streamId, head]) => states.get(streamId)?.version !== head);
    },
    replaceStates: async (partitionId, streamType, states, searchKey) => {
      this.stateMap.set(`${partitionId}\0${streamType}`, new Map());
      for (const s of states) this.putState(partitionId, streamType, s.streamId, s.version, s.state, s.search ?? null);
      if (searchKey !== undefined) this.searchKeys.set(`${partitionId}\0${streamType}`, searchKey);
    },
  };

  private statesOf(partitionId: number, streamType: string): Map<string, MemoryState> {
    const key = `${partitionId}\0${streamType}`;
    let states = this.stateMap.get(key);
    if (states === undefined) {
      states = new Map();
      this.stateMap.set(key, states);
    }
    return states;
  }

  async append(input: EventInput): Promise<EventRow> {
    const clash = this.rows.find(
      (r) =>
        r.partitionId === input.partitionId &&
        r.streamType === input.streamType &&
        r.streamId === input.streamId &&
        r.streamVersion === input.streamVersion,
    );
    if (clash !== undefined) {
      throw new UniqueViolationError();
    }
    const row: EventRow = {
      ...input,
      id: String(this.nextId++),
      recordedAt: new Date().toISOString(),
    };
    this.rows.push(row);
    return row;
  }

  async findByStream(
    partitionId: number,
    streamType: string,
    streamId: string,
  ): Promise<EventRow[]> {
    return this.rows
      .filter(
        (r) =>
          r.partitionId === partitionId &&
          r.streamType === streamType &&
          r.streamId === streamId,
      )
      .sort((a, b) => a.streamVersion - b.streamVersion);
  }

  async findByStreamType(
    partitionId: number,
    streamType: string,
  ): Promise<EventRow[]> {
    return this.rows
      .filter(
        (r) => r.partitionId === partitionId && r.streamType === streamType,
      )
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async streamHead(
    partitionId: number,
    streamType: string,
    streamId: string,
  ): Promise<number> {
    const versions = this.rows
      .filter(
        (r) => r.partitionId === partitionId && r.streamType === streamType && r.streamId === streamId,
      )
      .map((r) => r.streamVersion);
    return versions.length === 0 ? 0 : Math.max(...versions);
  }

  async position(): Promise<number> {
    return this.nextId - 1;
  }

  async rewriteStreams(marker: EventInput, rewrites: readonly StreamRewrite[]): Promise<EventRow> {
    for (const r of rewrites) {
      if ((await this.streamHead(r.partitionId, r.streamType, r.streamId)) !== r.expectedVersion) throw new UniqueViolationError();
    }
    const row = await this.append(marker);
    for (const r of rewrites) {
      const inStream = (e: EventRow) => e.partitionId === r.partitionId && e.streamType === r.streamType && e.streamId === r.streamId;
      const states = this.statesOf(r.partitionId, r.streamType);
      const pinned = [...this.pinMap.values()].filter((p) => p.partitionId === r.partitionId && p.streamType === r.streamType && p.streamId === r.streamId && !p.removed);
      if (r.payloads === null) {
        this.rows = this.rows.filter((e) => !inStream(e));
        states.delete(r.streamId);
        for (const p of pinned) await this.states.pins.unpin(p.set, p.partitionId, p.streamType, p.streamId);
        continue;
      }
      const payloads = r.payloads;
      this.rows = this.rows.map((e) => (inStream(e) && payloads.has(e.id) ? { ...e, payload: payloads.get(e.id) } : e));
      if ('state' in r) this.putState(r.partitionId, r.streamType, r.streamId, r.expectedVersion, r.state, r.search ?? null);
      for (const p of r.pins ?? []) {
        const old = pinned.find((x) => x.set === p.set);
        if (old !== undefined) await this.states.pins.pin(p.set, old.partitionId, old.streamType, old.streamId, old.position, p.state, p.search);
      }
    }
    return row;
  }

  async findSince(position: number): Promise<EventRow[]> {
    return this.rows.filter((r) => Number(r.id) > position).sort((a, b) => Number(a.id) - Number(b.id));
  }
}
