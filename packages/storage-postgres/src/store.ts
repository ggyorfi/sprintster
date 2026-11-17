import { CompiledQuery, type Kysely } from 'kysely';
import {
  buildStateSql,
  countKept,
  pageFromSql,
  shownBy,
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
  type PinRow,
  type StatePage,
  type StateQuery,
  type StateStore,
  type StreamRewrite,
} from '@sprintster/engine';

// The schema is the store's own, created on first use; the database type only names what Kysely connects to.
export interface EventStoreDatabase {
  events: Record<string, unknown>;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    partition_id BIGINT NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    stream_version BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    event_version INTEGER NOT NULL,
    payload JSONB,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    correlation_id TEXT,
    UNIQUE (partition_id, stream_type, stream_id, stream_version)
  )`,
  `CREATE TABLE IF NOT EXISTS states (
    seq BIGSERIAL PRIMARY KEY,
    partition_id BIGINT NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    state JSONB,
    search TEXT,
    UNIQUE (partition_id, stream_type, stream_id)
  )`,
  `CREATE TABLE IF NOT EXISTS state_meta (
    partition_id BIGINT NOT NULL,
    stream_type TEXT NOT NULL,
    search_key TEXT NOT NULL,
    PRIMARY KEY (partition_id, stream_type)
  )`,
  `CREATE SEQUENCE IF NOT EXISTS pins_change_seq`,
  `CREATE TABLE IF NOT EXISTS pins (
    set_name TEXT NOT NULL,
    partition_id BIGINT NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    state JSONB,
    search TEXT,
    removed BOOLEAN NOT NULL DEFAULT false,
    seq BIGINT NOT NULL,
    change_seq BIGINT NOT NULL UNIQUE,
    PRIMARY KEY (set_name, partition_id, stream_type, stream_id)
  )`,
  `CREATE INDEX IF NOT EXISTS pins_feed ON pins (set_name, partition_id, change_seq)`,
  // ADR 28: kept counts, and the default list order (-createdAt) read in index order.
  `ALTER TABLE state_meta ADD COLUMN IF NOT EXISTS total BIGINT`,
  `ALTER TABLE state_meta ADD COLUMN IF NOT EXISTS visible BIGINT`,
  `ALTER TABLE state_meta ADD COLUMN IF NOT EXISTS hide_path TEXT`,
  `CREATE INDEX IF NOT EXISTS states_created ON states (partition_id, stream_type, ((state #>> '{createdAt}') COLLATE "C") DESC NULLS LAST, stream_id)`,
];

type Run = (sql: string, params?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>;

interface RawRow {
  id: string;
  partition_id: string;
  stream_type: string;
  stream_id: string;
  stream_version: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  occurred_at: string;
  recorded_at: string;
  actor: string;
  correlation_id: string | null;
}

function toEventRow(r: Record<string, unknown>): EventRow {
  const row = r as unknown as RawRow;
  return {
    id: String(row.id),
    partitionId: Number(row.partition_id),
    streamType: row.stream_type,
    streamId: row.stream_id,
    streamVersion: Number(row.stream_version),
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actor: row.actor,
    correlationId: row.correlation_id,
  };
}

function isPgUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
const STREAM = 'partition_id = $1 AND stream_type = $2 AND stream_id = $3';

export function createPgEventStore(db: Kysely<EventStoreDatabase>): EventStore & { states: StateStore } {
  const runOn =
    (on: Pick<Kysely<EventStoreDatabase>, 'executeQuery'>): Run =>
    async (sql, params = []) =>
      (await on.executeQuery(CompiledQuery.raw(sql, [...params]))).rows as Array<Record<string, unknown>>;
  const direct = runOn(db);
  let schema: Promise<void> | undefined;
  const ready = () =>
    (schema ??= (async () => {
      for (const statement of DDL) await direct(statement);
    })().catch((err: unknown) => {
      schema = undefined;
      throw err;
    }));

  async function read(sql: string, params: readonly unknown[] = []) {
    await ready();
    return direct(sql, params);
  }

  async function transact<T>(work: (run: Run) => Promise<T>): Promise<T> {
    await ready();
    try {
      return await db.transaction().execute((tx) => work(runOn(tx)));
    } catch (err) {
      if (isPgUniqueViolation(err)) throw new UniqueViolationError();
      throw err;
    }
  }

  async function insertEvent(run: Run, input: EventInput): Promise<EventRow> {
    const [row] = await run(
      `INSERT INTO events (partition_id, stream_type, stream_id, stream_version, event_type, event_version, payload, occurred_at, recorded_at, actor, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11) RETURNING *`,
      [
        input.partitionId,
        input.streamType,
        input.streamId,
        input.streamVersion,
        input.eventType,
        input.eventVersion,
        json(input.payload),
        input.occurredAt,
        new Date().toISOString(),
        input.actor,
        input.correlationId,
      ],
    );
    return toEventRow(row!);
  }

  async function upsertState(run: Run, partitionId: number, streamType: string, streamId: string, version: number, state: unknown, search: string | null) {
    await run(
      `INSERT INTO states (partition_id, stream_type, stream_id, version, state, search) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (partition_id, stream_type, stream_id) DO UPDATE SET version = excluded.version, state = excluded.state, search = excluded.search`,
      [partitionId, streamType, streamId, version, json(state), search],
    );
  }

  async function head(run: Run, partitionId: number, streamType: string, streamId: string): Promise<number> {
    const [row] = await run(`SELECT COALESCE(MAX(stream_version), 0) AS head FROM events WHERE ${STREAM}`, [partitionId, streamType, streamId]);
    return Number(row?.['head'] ?? 0);
  }

  async function query(q: StateQuery, table: { name: 'states' } | { name: 'pins'; set: string }): Promise<StatePage> {
    const built = buildStateSql('pg', q, table);
    const rows = (await read(built.sql, built.params)) as Array<{ stream_id: string; version: string; state: unknown; sort_key: unknown }>;
    const total =
      built.countSql === null ? null : countKept(q, table) ? await keptTotal(q) : Number((await read(built.countSql, built.countParams))[0]?.['n'] ?? 0);
    return pageFromSql(q, rows, total, (state) => state);
  }

  // ADR 28: as the SQLite stores keep them (sqlite-shared.ts).
  async function keptTotal(q: StateQuery): Promise<number> {
    const key = [q.partitionId, q.streamType];
    const [meta] = await read(`SELECT total, visible, hide_path FROM state_meta WHERE partition_id = $1 AND stream_type = $2`, key);
    if (meta !== undefined && meta['total'] !== null && (q.hide === undefined || meta['hide_path'] === q.hide)) {
      return Number(q.hide === undefined ? meta['total'] : meta['visible']);
    }
    const shown = q.hide === undefined ? 'true' : `COALESCE((state #>> '{${q.hide.split('.').join(',')}}')::boolean, false) = false`;
    const [counted] = await read(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN ${shown} THEN 1 ELSE 0 END), 0) AS v FROM states WHERE partition_id = $1 AND stream_type = $2`,
      key,
    );
    const [total, visible] = [Number(counted?.['n'] ?? 0), Number(counted?.['v'] ?? 0)];
    await read(`UPDATE state_meta SET total = $3, visible = $4, hide_path = $5 WHERE partition_id = $1 AND stream_type = $2`, [...key, total, visible, q.hide ?? null]);
    return q.hide === undefined ? total : visible;
  }

  async function countChange(run: Run, partitionId: number, streamType: string, streamId: string, next: { state: unknown } | null): Promise<void> {
    const [meta] = await run(`SELECT total, hide_path FROM state_meta WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType]);
    if (meta === undefined || meta['total'] === null) return;
    const hide = meta['hide_path'] === null ? undefined : String(meta['hide_path']);
    const [old] = await run(`SELECT state FROM states WHERE ${STREAM}`, [partitionId, streamType, streamId]);
    const shown = (state: unknown) => (shownBy(state, hide) ? 1 : 0);
    const total = (next === null ? 0 : 1) - (old === undefined ? 0 : 1);
    const visible = (next === null ? 0 : shown(next.state)) - (old === undefined ? 0 : shown(old['state']));
    if (total !== 0 || visible !== 0) {
      await run(`UPDATE state_meta SET total = total + $3, visible = visible + $4 WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType, total, visible]);
    }
  }

  async function putState(run: Run, partitionId: number, streamType: string, streamId: string, version: number, state: unknown, search: string | null) {
    await countChange(run, partitionId, streamType, streamId, { state });
    await upsertState(run, partitionId, streamType, streamId, version, state, search);
  }

  async function pin(run: Run, set: string, partitionId: number, streamType: string, streamId: string, position: number, state: unknown, search: string | null) {
    const [row] = await run(
      `WITH n AS (SELECT nextval('pins_change_seq') AS s)
       INSERT INTO pins (set_name, partition_id, stream_type, stream_id, version, state, search, removed, seq, change_seq)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7, false, n.s, n.s FROM n
       ON CONFLICT (set_name, partition_id, stream_type, stream_id) DO UPDATE SET
         version = excluded.version, state = excluded.state, search = excluded.search, removed = false, change_seq = excluded.change_seq
       RETURNING change_seq`,
      [set, partitionId, streamType, streamId, position, json(state), search],
    );
    return Number(row!['change_seq']);
  }

  async function unpin(run: Run, set: string, partitionId: number, streamType: string, streamId: string): Promise<number | null> {
    const [row] = await run(
      `UPDATE pins SET removed = true, state = NULL, search = NULL, change_seq = nextval('pins_change_seq')
       WHERE set_name = $1 AND partition_id = $2 AND stream_type = $3 AND stream_id = $4 AND removed = false RETURNING change_seq`,
      [set, partitionId, streamType, streamId],
    );
    return row === undefined ? null : Number(row['change_seq']);
  }

  async function pinsOf(run: Run, partitionId: number, streamType: string, streamId: string) {
    return (
      await run(`SELECT set_name, version FROM pins WHERE ${STREAM} AND removed = false ORDER BY set_name`, [partitionId, streamType, streamId])
    ).map((r) => ({ set: String(r['set_name']), position: Number(r['version']) }));
  }

  const states: StateStore = {
    appendWithState: (input, project, searchOf) =>
      transact(async (run) => {
        const row = await insertEvent(run, input);
        const state = project(row);
        await putState(run, input.partitionId, input.streamType, input.streamId, input.streamVersion, state, searchOf?.(state) ?? null);
        return row;
      }),
    async getState(partitionId, streamType, streamId) {
      const [row] = await read(`SELECT stream_id, version, state FROM states WHERE ${STREAM}`, [partitionId, streamType, streamId]);
      return row === undefined ? null : { streamId: String(row['stream_id']), version: Number(row['version']), state: row['state'] };
    },
    async listStates(partitionId, streamType) {
      return (await read(`SELECT stream_id, version, state FROM states WHERE partition_id = $1 AND stream_type = $2 ORDER BY seq ASC`, [partitionId, streamType])).map(
        (r) => ({ streamId: String(r['stream_id']), version: Number(r['version']), state: r['state'] }),
      );
    },
    async statesVerified(partitionId, streamType, searchKey) {
      const [meta] = await read(`SELECT search_key FROM state_meta WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType]);
      return meta?.['search_key'] === searchKey;
    },
    async statesStale(partitionId, streamType, searchKey) {
      if (searchKey !== undefined) {
        const [has] = await read(`SELECT 1 FROM states WHERE partition_id = $1 AND stream_type = $2 LIMIT 1`, [partitionId, streamType]);
        const [meta] = await read(`SELECT search_key FROM state_meta WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType]);
        if (has !== undefined && meta?.['search_key'] !== searchKey) return true;
      }
      const [row] = await read(
        `SELECT EXISTS (
           SELECT 1 FROM (
             SELECT stream_id, MAX(stream_version) AS head FROM events WHERE partition_id = $1 AND stream_type = $2 GROUP BY stream_id
           ) e
           LEFT JOIN states s ON s.partition_id = $1 AND s.stream_type = $2 AND s.stream_id = e.stream_id
           WHERE s.version IS NULL OR s.version <> e.head
         ) AS stale`,
        [partitionId, streamType],
      );
      return row?.['stale'] === true;
    },
    replaceStates: (partitionId, streamType, list, searchKey) =>
      transact(async (run) => {
        await run(`DELETE FROM states WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType]);
        for (const s of list) await upsertState(run, partitionId, streamType, s.streamId, s.version, s.state, s.search ?? null);
        if (searchKey !== undefined) {
          await run(
            `INSERT INTO state_meta (partition_id, stream_type, search_key) VALUES ($1, $2, $3)
             ON CONFLICT (partition_id, stream_type) DO UPDATE SET search_key = excluded.search_key`,
            [partitionId, streamType, searchKey],
          );
        }
        const [meta] = await run(`SELECT hide_path FROM state_meta WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType]);
        if (meta !== undefined) {
          const hide = meta['hide_path'] === null ? undefined : String(meta['hide_path']);
          const visible = list.filter((s) => shownBy(s.state, hide)).length;
          await run(`UPDATE state_meta SET total = $3, visible = $4 WHERE partition_id = $1 AND stream_type = $2`, [partitionId, streamType, list.length, visible]);
        }
      }),
    query: (q) => query(q, { name: 'states' }),
    pins: {
      pin: (set, partitionId, streamType, streamId, position, state, search) =>
        transact((run) => pin(run, set, partitionId, streamType, streamId, position, state, search)),
      unpin: (set, partitionId, streamType, streamId) => transact((run) => unpin(run, set, partitionId, streamType, streamId)),
      query: (set, q) => query(q, { name: 'pins', set }),
      async since(set, partitionId, afterSeq, limit) {
        const rows = await read(
          `SELECT stream_type, stream_id, version, state, removed, change_seq FROM pins
           WHERE set_name = $1 AND partition_id = $2 AND change_seq > $3 ORDER BY change_seq ASC LIMIT $4`,
          [set, partitionId, afterSeq, limit],
        );
        const pins: PinRow[] = rows.map((r) => ({
          set,
          streamType: String(r['stream_type']),
          streamId: String(r['stream_id']),
          position: Number(r['version']),
          state: r['state'] ?? null,
          removed: r['removed'] === true,
          seq: Number(r['change_seq']),
        }));
        return { pins, next: pins.length === limit ? pins.at(-1)!.seq : null };
      },
      pinsOf: async (partitionId, streamType, streamId) => {
        await ready();
        return pinsOf(direct, partitionId, streamType, streamId);
      },
    },
  };

  return {
    append: (input) => transact((run) => insertEvent(run, input)),
    async findByStream(partitionId, streamType, streamId) {
      return (await read(`SELECT * FROM events WHERE ${STREAM} ORDER BY stream_version ASC`, [partitionId, streamType, streamId])).map(toEventRow);
    },
    async findByStreamType(partitionId, streamType) {
      return (await read(`SELECT * FROM events WHERE partition_id = $1 AND stream_type = $2 ORDER BY id ASC`, [partitionId, streamType])).map(toEventRow);
    },
    async streamHead(partitionId, streamType, streamId) {
      await ready();
      return head(direct, partitionId, streamType, streamId);
    },
    async position() {
      const [row] = await read(`SELECT COALESCE(MAX(id), 0) AS position FROM events`);
      return Number(row?.['position'] ?? 0);
    },
    async findSince(position) {
      return (await read(`SELECT * FROM events WHERE id > $1 ORDER BY id ASC`, [position])).map(toEventRow);
    },
    rewriteStreams: (marker: EventInput, rewrites: readonly StreamRewrite[]) =>
      transact(async (run) => {
        for (const r of rewrites) if ((await head(run, r.partitionId, r.streamType, r.streamId)) !== r.expectedVersion) throw new UniqueViolationError();
        const row = await insertEvent(run, marker);
        for (const r of rewrites) {
          const stream = [r.partitionId, r.streamType, r.streamId];
          if (r.payloads === null) {
            await run(`DELETE FROM events WHERE ${STREAM}`, stream);
            await countChange(run, r.partitionId, r.streamType, r.streamId, null);
            await run(`DELETE FROM states WHERE ${STREAM}`, stream);
            for (const { set } of await pinsOf(run, r.partitionId, r.streamType, r.streamId)) await unpin(run, set, r.partitionId, r.streamType, r.streamId);
            continue;
          }
          for (const [id, payload] of r.payloads) await run(`UPDATE events SET payload = $4::jsonb WHERE ${STREAM} AND id = $5`, [...stream, json(payload), id]);
          if ('state' in r) await putState(run, r.partitionId, r.streamType, r.streamId, r.expectedVersion, r.state, r.search ?? null);
          for (const p of r.pins ?? []) {
            await run(
              `UPDATE pins SET state = $4::jsonb, search = $5, change_seq = nextval('pins_change_seq') WHERE ${STREAM} AND set_name = $6 AND removed = false`,
              [...stream, json(p.state), p.search, p.set],
            );
          }
        }
        return row;
      }),
    states,
  };
}
