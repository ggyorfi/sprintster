import type Database from 'better-sqlite3';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
  type StateStore,
  type StoredState,
} from '@sprintster/engine';

const DDL = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
);
CREATE TABLE IF NOT EXISTS states (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  partition_id INTEGER NOT NULL,
  stream_type TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  UNIQUE (partition_id, stream_type, stream_id)
);
`;

interface Row {
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
}

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

interface StateRow {
  stream_id: string;
  version: number;
  state: string;
}

function toStoredState(r: StateRow): StoredState {
  return { streamId: r.stream_id, version: r.version, state: JSON.parse(r.state) };
}

function isSqliteUnique(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

export function createSqliteEventStore(db: Database.Database): EventStore & { states: StateStore } {
  db.exec(DDL);

  const insert = db.prepare(
    `INSERT INTO events
       (partition_id, stream_type, stream_id, stream_version, event_type, event_version, payload, occurred_at, recorded_at, actor, correlation_id)
     VALUES
       (@partition_id, @stream_type, @stream_id, @stream_version, @event_type, @event_version, @payload, @occurred_at, @recorded_at, @actor, @correlation_id)`,
  );
  const byId = db.prepare(`SELECT * FROM events WHERE id = ?`);
  const byStream = db.prepare(
    `SELECT * FROM events WHERE partition_id = ? AND stream_type = ? AND stream_id = ? ORDER BY stream_version ASC`,
  );
  const byStreamType = db.prepare(
    `SELECT * FROM events WHERE partition_id = ? AND stream_type = ? ORDER BY id ASC`,
  );
  const positionStmt = db.prepare(`SELECT COALESCE(MAX(id), 0) AS position FROM events`);
  const sinceStmt = db.prepare(`SELECT * FROM events WHERE id > ? ORDER BY id ASC`);
  const headStmt = db.prepare(
    `SELECT COALESCE(MAX(stream_version), 0) AS head FROM events WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`,
  );

  // seq survives an upsert, so a stream keeps the place its first event gave it.
  const upsertState = db.prepare(
    `INSERT INTO states (partition_id, stream_type, stream_id, version, state) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (partition_id, stream_type, stream_id) DO UPDATE SET version = excluded.version, state = excluded.state`,
  );
  const stateOf = db.prepare(
    `SELECT stream_id, version, state FROM states WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`,
  );
  const statesOf = db.prepare(
    `SELECT stream_id, version, state FROM states WHERE partition_id = ? AND stream_type = ? ORDER BY seq ASC`,
  );
  const staleStmt = db.prepare(
    `SELECT EXISTS (
       SELECT 1 FROM (
         SELECT stream_id, MAX(stream_version) AS head FROM events
         WHERE partition_id = ? AND stream_type = ? GROUP BY stream_id
       ) e
       LEFT JOIN states s ON s.partition_id = ? AND s.stream_type = ? AND s.stream_id = e.stream_id
       WHERE s.version IS NULL OR s.version <> e.head
     ) AS stale`,
  );
  const clearStates = db.prepare(`DELETE FROM states WHERE partition_id = ? AND stream_type = ?`);

  function insertEvent(input: EventInput): EventRow {
    const info = insert.run({
      partition_id: input.partitionId,
      stream_type: input.streamType,
      stream_id: input.streamId,
      stream_version: input.streamVersion,
      event_type: input.eventType,
      event_version: input.eventVersion,
      payload: JSON.stringify(input.payload),
      occurred_at: input.occurredAt,
      recorded_at: new Date().toISOString(),
      actor: input.actor,
      correlation_id: input.correlationId,
    });
    return toEventRow(byId.get(Number(info.lastInsertRowid)) as Row);
  }

  function mapUnique<T>(run: () => T): T {
    try {
      return run();
    } catch (err) {
      if (isSqliteUnique(err)) throw new UniqueViolationError();
      throw err;
    }
  }

  const appendWithState = db.transaction((input: EventInput, project: (row: EventRow) => unknown): EventRow => {
    const row = insertEvent(input);
    upsertState.run(input.partitionId, input.streamType, input.streamId, input.streamVersion, JSON.stringify(project(row)));
    return row;
  });

  const replaceStates = db.transaction((partitionId: number, streamType: string, states: readonly StoredState[]) => {
    clearStates.run(partitionId, streamType);
    for (const s of states) upsertState.run(partitionId, streamType, s.streamId, s.version, JSON.stringify(s.state));
  });

  return {
    async append(input: EventInput): Promise<EventRow> {
      return mapUnique(() => insertEvent(input));
    },

    async findByStream(partitionId, streamType, streamId) {
      return (byStream.all(partitionId, streamType, streamId) as Row[]).map(toEventRow);
    },

    async findByStreamType(partitionId, streamType) {
      return (byStreamType.all(partitionId, streamType) as Row[]).map(toEventRow);
    },

    async streamHead(partitionId, streamType, streamId) {
      const row = headStmt.get(partitionId, streamType, streamId) as { head: number };
      return row.head;
    },

    async position() {
      return (positionStmt.get() as { position: number }).position;
    },

    async findSince(position) {
      return (sinceStmt.all(position) as Row[]).map(toEventRow);
    },

    states: {
      async appendWithState(input, project) {
        return mapUnique(() => appendWithState(input, project));
      },
      async getState(partitionId, streamType, streamId) {
        const row = stateOf.get(partitionId, streamType, streamId) as StateRow | undefined;
        return row === undefined ? null : toStoredState(row);
      },
      async listStates(partitionId, streamType) {
        return (statesOf.all(partitionId, streamType) as StateRow[]).map(toStoredState);
      },
      async statesStale(partitionId, streamType) {
        const row = staleStmt.get(partitionId, streamType, partitionId, streamType) as { stale: number };
        return row.stale === 1;
      },
      async replaceStates(partitionId, streamType, states) {
        replaceStates(partitionId, streamType, states);
      },
    },
  };
}
