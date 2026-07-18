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
}

export class InMemoryEventStore implements EventStore {
  private rows: EventRow[] = [];
  private nextId = 1;

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
