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
}

// Current state per stream, derived from the log and rebuildable from it. A store that offers it lets reads skip folding events.
export interface StateStore {
  // Appends the event and records `project(row)` as the stream's state in one transaction; a throw from `project` appends nothing.
  appendWithState(input: EventInput, project: (row: EventRow) => unknown): Promise<EventRow>;
  getState(partitionId: number, streamType: string, streamId: string): Promise<StoredState | null>;
  // In order of each stream's first event.
  listStates(partitionId: number, streamType: string): Promise<StoredState[]>;
  // True when some stream's stored version differs from its latest event, as after an upgrade or a write that bypassed the states.
  statesStale(partitionId: number, streamType: string): Promise<boolean>;
  replaceStates(partitionId: number, streamType: string, states: readonly StoredState[]): Promise<void>;
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
  states?: StateStore;
}

export class InMemoryEventStore implements EventStore {
  private rows: EventRow[] = [];
  private nextId = 1;
  private stateMap = new Map<string, Map<string, StoredState>>();

  readonly states: StateStore = {
    appendWithState: async (input, project) => {
      const row = await this.append(input);
      try {
        this.statesOf(input.partitionId, input.streamType).set(input.streamId, {
          streamId: input.streamId,
          version: input.streamVersion,
          state: project(row),
        });
      } catch (err) {
        this.rows.splice(this.rows.indexOf(row), 1);
        throw err;
      }
      return row;
    },
    getState: async (partitionId, streamType, streamId) =>
      this.statesOf(partitionId, streamType).get(streamId) ?? null,
    listStates: async (partitionId, streamType) => [...this.statesOf(partitionId, streamType).values()],
    statesStale: async (partitionId, streamType) => {
      const states = this.statesOf(partitionId, streamType);
      const heads = new Map<string, number>();
      for (const r of this.rows) {
        if (r.partitionId === partitionId && r.streamType === streamType) {
          heads.set(r.streamId, Math.max(heads.get(r.streamId) ?? 0, r.streamVersion));
        }
      }
      return [...heads].some(([streamId, head]) => states.get(streamId)?.version !== head);
    },
    replaceStates: async (partitionId, streamType, states) => {
      this.stateMap.set(`${partitionId}\0${streamType}`, new Map(states.map((s) => [s.streamId, s] as const)));
    },
  };

  private statesOf(partitionId: number, streamType: string): Map<string, StoredState> {
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
}
