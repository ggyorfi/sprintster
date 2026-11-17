import { buildStateSql, countKept, pageFromSql, shownBy, type PinRow, type StatePage, type StateQuery } from './query.js';

// What the SQLite stores (better-sqlite3 locally, a Durable Object's storage) share: plain SQL through the caller's driver.
export type SqliteExec = (sql: string, params: readonly unknown[]) => Array<Record<string, unknown>>;

export const SQLITE_QUERY_DDL = [
  `CREATE TABLE IF NOT EXISTS state_meta (
    partition_id INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    search_key TEXT NOT NULL,
    total INTEGER,
    visible INTEGER,
    hide_path TEXT,
    PRIMARY KEY (partition_id, stream_type)
  )`,
  // ADR 28: the default list order (-createdAt) read in index order, so a page reads its own rows, not the whole type.
  `CREATE INDEX IF NOT EXISTS states_created ON states (partition_id, stream_type, json_extract(state, '$.createdAt') DESC, stream_id)`,
  `CREATE TABLE IF NOT EXISTS pins (
    set_name TEXT NOT NULL,
    partition_id INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    state TEXT,
    search TEXT,
    removed INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    change_seq INTEGER NOT NULL UNIQUE,
    PRIMARY KEY (set_name, partition_id, stream_type, stream_id)
  )`,
  `CREATE INDEX IF NOT EXISTS pins_feed ON pins (set_name, partition_id, change_seq)`,
];

// States tables made before ADR 24 have no search column.
export function ensureSqliteSearchColumn(exec: SqliteExec): void {
  if (!exec(`PRAGMA table_info(states)`, []).some((c) => c['name'] === 'search')) exec(`ALTER TABLE states ADD COLUMN search TEXT`, []);
}

// state_meta tables made before ADR 28 have no counts.
export function ensureSqliteCountColumns(exec: SqliteExec): void {
  const have = new Set(exec(`PRAGMA table_info(state_meta)`, []).map((c) => c['name']));
  for (const [name, type] of [['total', 'INTEGER'], ['visible', 'INTEGER'], ['hide_path', 'TEXT']] as const) {
    if (!have.has(name)) exec(`ALTER TABLE state_meta ADD COLUMN ${name} ${type}`, []);
  }
}

const parse = (state: unknown) => (typeof state === 'string' ? JSON.parse(state) : state);

type Table = { name: 'states' } | { name: 'pins'; set: string };

export function sqliteQuery(exec: SqliteExec, q: StateQuery, table: Table): StatePage {
  const built = buildStateSql('sqlite', q, table);
  const rows = exec(built.sql, built.params) as Array<{ stream_id: string; version: number; state: unknown; sort_key: unknown }>;
  const total = built.countSql === null ? null : countKept(q, table) ? keptTotal(exec, q) : Number(exec(built.countSql, built.countParams)[0]?.['n'] ?? 0);
  return pageFromSql(q, rows, total, parse);
}

// ADR 28: a type's counts are kept in state_meta as its states change; the first count after they were unknown fills them in.
function keptTotal(exec: SqliteExec, q: StateQuery): number {
  const key = [q.partitionId, q.streamType];
  const meta = exec(`SELECT total, visible, hide_path FROM state_meta WHERE partition_id = ? AND stream_type = ?`, key)[0];
  if (meta !== undefined && meta['total'] !== null && (q.hide === undefined || meta['hide_path'] === q.hide)) {
    return Number(q.hide === undefined ? meta['total'] : meta['visible']);
  }
  const shown = q.hide === undefined ? '1' : `COALESCE(json_extract(state, '$.${q.hide}'), 0) = 0`;
  const counted = exec(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN ${shown} THEN 1 ELSE 0 END), 0) AS v FROM states WHERE partition_id = ? AND stream_type = ?`, key)[0];
  const [total, visible] = [Number(counted?.['n'] ?? 0), Number(counted?.['v'] ?? 0)];
  exec(`UPDATE state_meta SET total = ?, visible = ?, hide_path = ? WHERE partition_id = ? AND stream_type = ?`, [total, visible, q.hide ?? null, ...key]);
  return q.hide === undefined ? total : visible;
}

// Called before a state is written (`next`) or deleted (null), in the same transaction, so a kept count stays right.
export function sqliteCountChange(exec: SqliteExec, partitionId: number, streamType: string, streamId: string, next: { state: unknown } | null): void {
  const key = [partitionId, streamType];
  const meta = exec(`SELECT total, hide_path FROM state_meta WHERE partition_id = ? AND stream_type = ?`, key)[0];
  if (meta === undefined || meta['total'] === null) return;
  const hide = meta['hide_path'] === null ? undefined : String(meta['hide_path']);
  const old = exec(`SELECT state FROM states WHERE partition_id = ? AND stream_type = ? AND stream_id = ?`, [...key, streamId])[0];
  const shown = (state: unknown) => (shownBy(state, hide) ? 1 : 0);
  const total = (next === null ? 0 : 1) - (old === undefined ? 0 : 1);
  const visible = (next === null ? 0 : shown(next.state)) - (old === undefined ? 0 : shown(parse(old['state'])));
  if (total !== 0 || visible !== 0) exec(`UPDATE state_meta SET total = total + ?, visible = visible + ? WHERE partition_id = ? AND stream_type = ?`, [total, visible, ...key]);
}

// After replaceStates: the counts of exactly these states.
export function sqliteRecount(exec: SqliteExec, partitionId: number, streamType: string, states: ReadonlyArray<{ state: unknown }>): void {
  const key = [partitionId, streamType];
  const meta = exec(`SELECT hide_path FROM state_meta WHERE partition_id = ? AND stream_type = ?`, key)[0];
  if (meta === undefined) return;
  const hide = meta['hide_path'] === null ? undefined : String(meta['hide_path']);
  const visible = states.filter((s) => shownBy(s.state, hide)).length;
  exec(`UPDATE state_meta SET total = ?, visible = ? WHERE partition_id = ? AND stream_type = ?`, [states.length, visible, ...key]);
}

export function sqliteSearchKeyStale(exec: SqliteExec, partitionId: number, streamType: string, searchKey: string): boolean {
  const hasStates = exec(`SELECT 1 FROM states WHERE partition_id = ? AND stream_type = ? LIMIT 1`, [partitionId, streamType]).length > 0;
  if (!hasStates) return false;
  const row = exec(`SELECT search_key FROM state_meta WHERE partition_id = ? AND stream_type = ?`, [partitionId, streamType])[0];
  return row?.['search_key'] !== searchKey;
}

export function sqliteSearchKeyIs(exec: SqliteExec, partitionId: number, streamType: string, searchKey: string): boolean {
  return exec(`SELECT search_key FROM state_meta WHERE partition_id = ? AND stream_type = ?`, [partitionId, streamType])[0]?.['search_key'] === searchKey;
}

export function sqliteSetSearchKey(exec: SqliteExec, partitionId: number, streamType: string, searchKey: string): void {
  exec(
    `INSERT INTO state_meta (partition_id, stream_type, search_key) VALUES (?, ?, ?)
     ON CONFLICT (partition_id, stream_type) DO UPDATE SET search_key = excluded.search_key`,
    [partitionId, streamType, searchKey],
  );
}

function nextChangeSeq(exec: SqliteExec): number {
  return Number(exec(`SELECT COALESCE(MAX(change_seq), 0) + 1 AS n FROM pins`, [])[0]?.['n'] ?? 1);
}

export function sqlitePin(exec: SqliteExec, set: string, partitionId: number, streamType: string, streamId: string, position: number, state: unknown, search: string | null): number {
  const seq = nextChangeSeq(exec);
  exec(
    `INSERT INTO pins (set_name, partition_id, stream_type, stream_id, version, state, search, removed, seq, change_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT (set_name, partition_id, stream_type, stream_id) DO UPDATE SET
       version = excluded.version, state = excluded.state, search = excluded.search, removed = 0, change_seq = excluded.change_seq`,
    [set, partitionId, streamType, streamId, position, JSON.stringify(state), search, seq, seq],
  );
  return seq;
}

export function sqliteUnpin(exec: SqliteExec, set: string, partitionId: number, streamType: string, streamId: string): number | null {
  const live = exec(`SELECT 1 FROM pins WHERE set_name = ? AND partition_id = ? AND stream_type = ? AND stream_id = ? AND removed = 0`, [set, partitionId, streamType, streamId]);
  if (live.length === 0) return null;
  const seq = nextChangeSeq(exec);
  exec(
    `UPDATE pins SET removed = 1, state = NULL, search = NULL, change_seq = ? WHERE set_name = ? AND partition_id = ? AND stream_type = ? AND stream_id = ?`,
    [seq, set, partitionId, streamType, streamId],
  );
  return seq;
}

export function sqliteRepin(exec: SqliteExec, set: string, partitionId: number, streamType: string, streamId: string, state: unknown, search: string | null): void {
  exec(
    `UPDATE pins SET state = ?, search = ?, change_seq = ? WHERE set_name = ? AND partition_id = ? AND stream_type = ? AND stream_id = ? AND removed = 0`,
    [JSON.stringify(state), search, nextChangeSeq(exec), set, partitionId, streamType, streamId],
  );
}

export function sqliteSince(exec: SqliteExec, set: string, partitionId: number, afterSeq: number, limit: number): { pins: PinRow[]; next: number | null } {
  const rows = exec(
    `SELECT stream_type, stream_id, version, state, removed, change_seq FROM pins
     WHERE set_name = ? AND partition_id = ? AND change_seq > ? ORDER BY change_seq ASC LIMIT ?`,
    [set, partitionId, afterSeq, limit],
  );
  const pins = rows.map((r) => ({
    set,
    streamType: String(r['stream_type']),
    streamId: String(r['stream_id']),
    position: Number(r['version']),
    state: r['state'] === null ? null : parse(r['state']),
    removed: Number(r['removed']) === 1,
    seq: Number(r['change_seq']),
  }));
  return { pins, next: pins.length === limit ? pins.at(-1)!.seq : null };
}

export function sqlitePinsOf(exec: SqliteExec, partitionId: number, streamType: string, streamId: string): Array<{ set: string; position: number }> {
  return exec(`SELECT set_name, version FROM pins WHERE partition_id = ? AND stream_type = ? AND stream_id = ? AND removed = 0 ORDER BY set_name`, [
    partitionId,
    streamType,
    streamId,
  ]).map((r) => ({ set: String(r['set_name']), position: Number(r['version']) }));
}

export function sqliteUnpinStream(exec: SqliteExec, partitionId: number, streamType: string, streamId: string): void {
  for (const { set } of sqlitePinsOf(exec, partitionId, streamType, streamId)) sqliteUnpin(exec, set, partitionId, streamType, streamId);
}
