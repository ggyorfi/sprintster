import type Database from 'better-sqlite3';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
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

function isSqliteUnique(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  );
}

export function createSqliteEventStore(db: Database.Database): EventStore {
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
  const headStmt = db.prepare(
    `SELECT COALESCE(MAX(stream_version), 0) AS head FROM events WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`,
  );

  return {
    async append(input: EventInput): Promise<EventRow> {
      try {
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
      } catch (err) {
        if (isSqliteUnique(err)) throw new UniqueViolationError();
        throw err;
      }
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
  };
}
