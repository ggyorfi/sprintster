import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
  type StateStore,
  type StoredState,
} from '@sprintster/engine';

type SqlValue = string | number | null;

// The slice of a Durable Object's `ctx.storage` this store uses, so the package needs no Workers type definitions.
export interface DurableObjectSqlStorage {
  sql: {
    exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): { toArray(): T[]; one(): T };
  };
  transactionSync<T>(fn: () => T): T;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    partition_id INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    stream_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    correlation_id TEXT,
    UNIQUE (partition_id, stream_type, stream_id, stream_version)
  )`,
  `CREATE TABLE IF NOT EXISTS states (
    seq INTEGER PRIMARY KEY,
    partition_id INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    state TEXT NOT NULL,
    UNIQUE (partition_id, stream_type, stream_id)
  )`,
];

type Row = {
  id: number;
  partition_id: number;
  stream_type: string;
  stream_id: string;
  stream_version: number;
  event_type: string;
  event_version: number;
  payload: string;
  occurred_at: string;
  recorded_at: string;
  actor: string;
  correlation_id: string | null;
};

type StateRow = { stream_id: string; version: number; state: string };

function toEventRow(r: Row): EventRow {
  return {
    id: String(r.id),
    partitionId: r.partition_id,
    streamType: r.stream_type,
    streamId: r.stream_id,
    streamVersion: r.stream_version,
    eventType: r.event_type,
    eventVersion: r.event_version,
    payload: JSON.parse(r.payload),
    occurredAt: r.occurred_at,
    recordedAt: r.recorded_at,
    actor: r.actor,
    correlationId: r.correlation_id,
  };
}

function toStoredState(r: StateRow): StoredState {
  return { streamId: r.stream_id, version: r.version, state: JSON.parse(r.state) };
}

// The Durable Object SQL API reports a constraint failure only in the error message.
function isUnique(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

function mapUnique<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (isUnique(err)) throw new UniqueViolationError();
    throw err;
  }
}

// The SQL API is synchronous, so every method completes before it returns and a Durable Object's input gate keeps writes in order.
export function createDurableObjectEventStore(storage: DurableObjectSqlStorage): EventStore & { states: StateStore } {
  const { sql } = storage;
  for (const statement of DDL) sql.exec(statement);

  function insertEvent(input: EventInput): EventRow {
    return toEventRow(
      sql
        .exec<Row>(
          `INSERT INTO events
             (partition_id, stream_type, stream_id, stream_version, event_type, event_version, payload, occurred_at, recorded_at, actor, correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
          input.partitionId,
          input.streamType,
          input.streamId,
          input.streamVersion,
          input.eventType,
          input.eventVersion,
          JSON.stringify(input.payload),
          input.occurredAt,
          new Date().toISOString(),
          input.actor,
          input.correlationId,
        )
        .one(),
    );
  }

  // seq survives an upsert, so a stream keeps the place its first event gave it.
  function upsertState(partitionId: number, streamType: string, streamId: string, version: number, state: unknown): void {
    sql.exec(
      `INSERT INTO states (partition_id, stream_type, stream_id, version, state) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (partition_id, stream_type, stream_id) DO UPDATE SET version = excluded.version, state = excluded.state`,
      partitionId,
      streamType,
      streamId,
      version,
      JSON.stringify(state),
    );
  }

  return {
    async append(input) {
      return mapUnique(() => insertEvent(input));
    },

    async findByStream(partitionId, streamType, streamId) {
      return sql
        .exec<Row>(
          `SELECT * FROM events WHERE partition_id = ? AND stream_type = ? AND stream_id = ? ORDER BY stream_version ASC`,
          partitionId,
          streamType,
          streamId,
        )
        .toArray()
        .map(toEventRow);
    },

    async findByStreamType(partitionId, streamType) {
      return sql
        .exec<Row>(`SELECT * FROM events WHERE partition_id = ? AND stream_type = ? ORDER BY id ASC`, partitionId, streamType)
        .toArray()
        .map(toEventRow);
    },

    async streamHead(partitionId, streamType, streamId) {
      return sql
        .exec<{ head: number }>(
          `SELECT COALESCE(MAX(stream_version), 0) AS head FROM events WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`,
          partitionId,
          streamType,
          streamId,
        )
        .one().head;
    },

    states: {
      async appendWithState(input, project) {
        return mapUnique(() =>
          storage.transactionSync(() => {
            const row = insertEvent(input);
            upsertState(input.partitionId, input.streamType, input.streamId, input.streamVersion, project(row));
            return row;
          }),
        );
      },

      async getState(partitionId, streamType, streamId) {
        const rows = sql
          .exec<StateRow>(
            `SELECT stream_id, version, state FROM states WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`,
            partitionId,
            streamType,
            streamId,
          )
          .toArray();
        return rows[0] === undefined ? null : toStoredState(rows[0]);
      },

      async listStates(partitionId, streamType) {
        return sql
          .exec<StateRow>(
            `SELECT stream_id, version, state FROM states WHERE partition_id = ? AND stream_type = ? ORDER BY seq ASC`,
            partitionId,
            streamType,
          )
          .toArray()
          .map(toStoredState);
      },

      async statesStale(partitionId, streamType) {
        return (
          sql
            .exec<{ stale: number }>(
              `SELECT EXISTS (
                 SELECT 1 FROM (
                   SELECT stream_id, MAX(stream_version) AS head FROM events
                   WHERE partition_id = ? AND stream_type = ? GROUP BY stream_id
                 ) e
                 LEFT JOIN states s ON s.partition_id = ? AND s.stream_type = ? AND s.stream_id = e.stream_id
                 WHERE s.version IS NULL OR s.version <> e.head
               ) AS stale`,
              partitionId,
              streamType,
              partitionId,
              streamType,
            )
            .one().stale === 1
        );
      },

      async replaceStates(partitionId, streamType, states) {
        storage.transactionSync(() => {
          sql.exec(`DELETE FROM states WHERE partition_id = ? AND stream_type = ?`, partitionId, streamType);
          for (const s of states) upsertState(partitionId, streamType, s.streamId, s.version, s.state);
        });
      },
    },
  };
}
