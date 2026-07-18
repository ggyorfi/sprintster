import { sql, type Generated, type Kysely } from 'kysely';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
} from '@sprintster/engine';

interface EventsTable {
  id: Generated<string>;
  partition_id: string;
  stream_type: string;
  stream_id: string;
  stream_version: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  occurred_at: Date;
  recorded_at: Generated<Date>;
  actor: string;
  correlation_id: string | null;
}

export interface EventStoreDatabase {
  events: EventsTable;
}

interface RawRow {
  id: string;
  partition_id: string;
  stream_type: string;
  stream_id: string;
  stream_version: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  occurred_at: Date;
  recorded_at: Date;
  actor: string;
  correlation_id: string | null;
}

function toEventRow(r: RawRow): EventRow {
  return {
    id: r.id,
    partitionId: Number(r.partition_id),
    streamType: r.stream_type,
    streamId: r.stream_id,
    streamVersion: Number(r.stream_version),
    eventType: r.event_type,
    eventVersion: r.event_version,
    payload: r.payload,
    occurredAt: r.occurred_at.toISOString(),
    recordedAt: r.recorded_at.toISOString(),
    actor: r.actor,
    correlationId: r.correlation_id,
  };
}

function isPgUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === '23505'
  );
}

export function createPgEventStore(db: Kysely<EventStoreDatabase>): EventStore {
  return {
    async append(input: EventInput): Promise<EventRow> {
      try {
        const row = await db
          .insertInto('events')
          .values({
            partition_id: String(input.partitionId),
            stream_type: input.streamType,
            stream_id: input.streamId,
            stream_version: String(input.streamVersion),
            event_type: input.eventType,
            event_version: input.eventVersion,
            payload: input.payload,
            occurred_at: new Date(input.occurredAt),
            actor: input.actor,
            correlation_id: input.correlationId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return toEventRow(row as RawRow);
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          throw new UniqueViolationError();
        }
        throw err;
      }
    },

    async findByStream(partitionId, streamType, streamId) {
      const rows = await db
        .selectFrom('events')
        .selectAll()
        .where('partition_id', '=', String(partitionId))
        .where('stream_type', '=', streamType)
        .where('stream_id', '=', streamId)
        .orderBy('stream_version', 'asc')
        .execute();
      return rows.map((r) => toEventRow(r as RawRow));
    },

    async findByStreamType(partitionId, streamType) {
      const rows = await db
        .selectFrom('events')
        .selectAll()
        .where('partition_id', '=', String(partitionId))
        .where('stream_type', '=', streamType)
        .orderBy('id', 'asc')
        .execute();
      return rows.map((r) => toEventRow(r as RawRow));
    },

    async streamHead(partitionId, streamType, streamId) {
      const row = await db
        .selectFrom('events')
        .select(sql<string>`COALESCE(MAX(stream_version::bigint), 0)`.as('head'))
        .where('partition_id', '=', String(partitionId))
        .where('stream_type', '=', streamType)
        .where('stream_id', '=', streamId)
        .executeTakeFirst();
      return row ? Number(row.head) : 0;
    },
  };
}
