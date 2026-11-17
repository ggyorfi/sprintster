// ADR 24 and 26: one page of stored states, chosen and ordered by the store.

export type SortKind = 'text' | 'number' | 'boolean';

export interface StateSort {
  // A property path in the state, dot separated (`title`, `title.hu`).
  path: string;
  kind: SortKind;
  descending: boolean;
  // Sort by a field of the referenced record: `path` holds its id, `ref.path` the field in its state.
  ref?: { streamType: string; path: string };
}

// The position after the last row of a page: its sort value (its order of first write when unsorted) and its id.
export interface StateCursor {
  key: string | number | boolean | null;
  id: string;
}

export interface StateQuery {
  partitionId: number;
  streamType: string;
  // Normalized words (normalizeSearch); every one must appear in the search text, or start the id when idPrefix.
  terms?: readonly string[];
  idPrefix?: boolean;
  sort?: StateSort;
  // A boolean property; rows where it is true are left out.
  hide?: string;
  ids?: readonly string[];
  limit: number;
  offset?: number;
  after?: StateCursor | null;
  // False skips counting the matches: a later page of a list whose total is already known.
  count?: boolean;
  // ADR 27: every condition must hold.
  where?: readonly StateCondition[];
}

export interface StateCondition {
  path: string;
  op: 'equals' | 'notEquals' | 'startsWith' | 'notStartsWith';
  value: string | number | boolean;
}

export function stateConditionHolds(state: unknown, c: StateCondition): boolean {
  const v = readPath(state, c.path);
  const present = v !== null && v !== undefined;
  switch (c.op) {
    case 'equals':
      return present && v === c.value;
    case 'notEquals':
      return !present || v !== c.value;
    case 'startsWith':
      return typeof v === 'string' && v.startsWith(String(c.value));
    case 'notStartsWith':
      return typeof v !== 'string' || !v.startsWith(String(c.value));
  }
}

export interface QueriedState {
  streamId: string;
  version: number;
  state: unknown;
}

export interface StatePage {
  states: QueriedState[];
  // Only for offset pages: every row the query matches.
  total?: number;
  // Set whenever the page is full; the page after the last one is empty.
  next: StateCursor | null;
}

export interface PinRow {
  set: string;
  streamType: string;
  streamId: string;
  position: number;
  state: unknown;
  removed: boolean;
  seq: number;
}

// ADR 26: one chosen version per record in a named set, queried like states, with a feed of what changed.
export interface PinStore {
  pin(set: string, partitionId: number, streamType: string, streamId: string, position: number, state: unknown, search: string | null): Promise<number>;
  unpin(set: string, partitionId: number, streamType: string, streamId: string): Promise<number | null>;
  query(set: string, q: StateQuery): Promise<StatePage>;
  since(set: string, partitionId: number, afterSeq: number, limit: number): Promise<{ pins: PinRow[]; next: number | null }>;
  pinsOf(partitionId: number, streamType: string, streamId: string): Promise<Array<{ set: string; position: number }>>;
}

const PATH = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;

function checkPath(path: string): string {
  if (!PATH.test(path)) throw new Error(`not a property path: '${path}'`);
  return path;
}

// Case and accents never decide a match ("ora" finds "Óra"); done here, since SQLite's LOWER folds only ASCII.
export function normalizeSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function searchTerms(q: string | undefined): string[] {
  return q === undefined ? [] : normalizeSearch(q).split(/\s+/).filter(Boolean);
}

// The text a record is searched by: its search fields' values, every language of a translated one.
export function searchTextOf(state: unknown, fields: readonly string[]): string | null {
  if (fields.length === 0 || state === null || typeof state !== 'object') return null;
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) add(x);
    else parts.push(String(v));
  };
  for (const f of fields) add((state as Record<string, unknown>)[f]);
  return normalizeSearch(parts.join(' '));
}

// ADR 28: a query whose total a store may keep rather than count: a type's states, filtered by nothing but `hide`.
export function countKept(q: StateQuery, table: { name: 'states' | 'pins' }): boolean {
  return table.name === 'states' && q.after == null && q.count !== false && q.ids === undefined && (q.where ?? []).length === 0 && (q.terms ?? []).length === 0;
}

// Whether a list that hides by `hide` shows the state, as the SQL stores' COALESCE(<hide>, 0) = 0 has it.
export function shownBy(state: unknown, hide: string | undefined): boolean {
  if (hide === undefined) return true;
  const v = readPath(state, hide);
  return v === undefined || v === null || v === false || v === 0;
}

export function readPath(state: unknown, path: string): unknown {
  let at: unknown = state;
  for (const seg of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<string, unknown>)[seg];
  }
  return at;
}

function typed(v: unknown, kind: SortKind): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (kind === 'number') return typeof v === 'number' ? v : Number.isNaN(Number(v)) ? null : Number(v);
  if (kind === 'boolean') return typeof v === 'boolean' ? v : null;
  return typeof v === 'string' ? v : typeof v === 'object' ? null : String(v);
}

function compareKeys(a: string | number | boolean | null, b: string | number | boolean | null): number {
  if (a === b) return 0;
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // Code point order, as the SQL stores compare text (binary in SQLite, COLLATE "C" in Postgres).
  return String(a) < String(b) ? -1 : 1;
}

export interface EvaluatedRow {
  streamId: string;
  version: number;
  state: unknown;
  search: string | null;
  seq: number;
}

// The in-memory store's answer, and the definition the SQL stores must match.
export function evaluateQuery(rows: readonly EvaluatedRow[], q: StateQuery, refState: (streamType: string, id: string) => unknown): StatePage {
  const sort = q.sort;
  const keyOf = (r: EvaluatedRow): string | number | boolean | null => {
    if (sort === undefined) return r.seq;
    if (sort.ref !== undefined) {
      const id = readPath(r.state, sort.path);
      return typeof id === 'string' ? typed(readPath(refState(sort.ref.streamType, id), sort.ref.path), sort.kind) : null;
    }
    return typed(readPath(r.state, sort.path), sort.kind);
  };
  const terms = q.terms ?? [];
  const matching = rows.filter((r) => {
    if (q.hide !== undefined && readPath(r.state, q.hide) === true) return false;
    if (q.ids !== undefined && !q.ids.includes(r.streamId)) return false;
    if (q.where !== undefined && !q.where.every((c) => stateConditionHolds(r.state, c))) return false;
    return terms.every((t) => (r.search ?? '').includes(t) || (q.idPrefix === true && r.streamId.startsWith(t)));
  });
  const keyed = matching.map((r) => ({ r, k: keyOf(r) }));
  const desc = sort?.descending === true;
  const byId = (x: { r: EvaluatedRow }, y: { r: EvaluatedRow }) => (x.r.streamId < y.r.streamId ? -1 : x.r.streamId > y.r.streamId ? 1 : 0);
  keyed.sort((x, y) => {
    if (sort === undefined) return Number(x.k) - Number(y.k);
    if (x.k === null || y.k === null) return x.k === y.k ? byId(x, y) : x.k === null ? 1 : -1;
    const c = compareKeys(x.k, y.k);
    return c !== 0 ? (desc ? -c : c) : byId(x, y);
  });
  let from = keyed;
  const cur = q.after;
  if (cur != null) {
    from = keyed.filter((x) => {
      if (sort === undefined) return Number(x.k) > Number(cur.key);
      if (cur.key === null) return x.k === null && x.r.streamId > cur.id;
      if (x.k === null) return true;
      const c = compareKeys(x.k, cur.key);
      return (desc ? c < 0 : c > 0) || (c === 0 && x.r.streamId > cur.id);
    });
  }
  const start = q.offset ?? 0;
  const page = from.slice(start, start + q.limit);
  const last = page.at(-1);
  return {
    states: page.map((x) => ({ streamId: x.r.streamId, version: x.r.version, state: x.r.state })),
    ...(q.after === undefined && q.count !== false ? { total: keyed.length } : {}),
    next: last !== undefined && page.length === q.limit ? { key: last.k, id: last.r.streamId } : null,
  };
}

export type SqlDialect = 'sqlite' | 'pg';

export interface SqlQuery {
  sql: string;
  params: unknown[];
  countSql: string | null;
  countParams: unknown[];
}

const bindable = (dialect: SqlDialect, v: unknown) => (dialect === 'sqlite' && typeof v === 'boolean' ? Number(v) : v);

// Both tables have stream_id, version, state, search and seq; `pins` is also restricted to one set.
export function buildStateSql(dialect: SqlDialect, q: StateQuery, table: { name: 'states' } | { name: 'pins'; set: string }): SqlQuery {
  const placeholders = (params: unknown[]) => (v: unknown) => {
    params.push(bindable(dialect, v));
    return dialect === 'pg' ? `$${params.length}` : '?';
  };
  const json = (alias: string, path: string, kind: SortKind) => {
    checkPath(path);
    if (dialect === 'sqlite') return kind === 'number' ? `CAST(json_extract(${alias}.state, '$.${path}') AS REAL)` : `json_extract(${alias}.state, '$.${path}')`;
    const at = `(${alias}.state #>> '{${path.split('.').join(',')}}')`;
    return kind === 'number' ? `(${at}::numeric)` : kind === 'boolean' ? `(${at}::boolean)` : `(${at} COLLATE "C")`;
  };
  const filters = (p: (v: unknown) => string): string[] => {
    const where = [`s.partition_id = ${p(q.partitionId)}`, `s.stream_type = ${p(q.streamType)}`];
    if (table.name === 'pins') where.push(`s.set_name = ${p(table.set)}`, dialect === 'pg' ? 's.removed = false' : 's.removed = 0');
    if (q.hide !== undefined) {
      checkPath(q.hide);
      where.push(
        dialect === 'sqlite'
          ? `COALESCE(json_extract(s.state, '$.${q.hide}'), 0) = 0`
          : `COALESCE((s.state #>> '{${q.hide.split('.').join(',')}}')::boolean, false) = false`,
      );
    }
    if (q.ids !== undefined) where.push(q.ids.length === 0 ? '1 = 0' : `s.stream_id IN (${q.ids.map((id) => p(id)).join(', ')})`);
    for (const c of q.where ?? []) {
      checkPath(c.path);
      // Text in both dialects, so a number or boolean compares as its JSON text (true, 5).
      const v = dialect === 'sqlite' ? `CAST(json_extract(s.state, '$.${c.path}') AS TEXT)` : `(s.state #>> '{${c.path.split('.').join(',')}}')`;
      const text = dialect === 'sqlite' && typeof c.value === 'boolean' ? (c.value ? '1' : '0') : String(c.value);
      const prefix = (x: string) => (dialect === 'sqlite' ? `substr(${x}, 1, ${p(text.length)}) = ${p(text)}` : `left(${x}, ${p(text.length)}) = ${p(text)}`);
      const stringOnly = dialect === 'sqlite' ? `json_type(s.state, '$.${c.path}') = 'text'` : `jsonb_typeof(s.state #> '{${c.path.split('.').join(',')}}') = 'string'`;
      if (c.op === 'equals') where.push(`${v} = ${p(text)}`);
      else if (c.op === 'notEquals') where.push(`(${v} IS NULL OR ${v} <> ${p(text)})`);
      else if (c.op === 'startsWith') where.push(`(${stringOnly} AND ${prefix(v)})`);
      else where.push(`(${v} IS NULL OR NOT (${stringOnly}) OR NOT (${prefix(v)}))`);
    }
    for (const t of q.terms ?? []) {
      const found = dialect === 'sqlite' ? `instr(COALESCE(s.search, ''), ${p(t)}) > 0` : `strpos(COALESCE(s.search, ''), ${p(t)}) > 0`;
      if (q.idPrefix === true) {
        const prefix = dialect === 'sqlite' ? `substr(s.stream_id, 1, ${p(t.length)}) = ${p(t)}` : `left(s.stream_id, ${p(t.length)}) = ${p(t)}`;
        where.push(`(${found} OR ${prefix})`);
      } else where.push(found);
    }
    return where;
  };

  // Positional placeholders (SQLite) need the parameters in the order they appear: the join comes before the filters.
  const params: unknown[] = [];
  const p = placeholders(params);
  const sort = q.sort;
  let join = '';
  let key = 's.seq';
  if (sort !== undefined) {
    if (sort.ref !== undefined) {
      join = ` LEFT JOIN states r ON r.partition_id = s.partition_id AND r.stream_type = ${p(sort.ref.streamType)} AND r.stream_id = ${json('s', sort.path, 'text')}`;
      key = json('r', sort.ref.path, sort.kind);
    } else key = json('s', sort.path, sort.kind);
  }
  const where = filters(p);
  const countParams: unknown[] = [];
  const countWhere = filters(placeholders(countParams));
  const cast = (ph: string) =>
    dialect === 'pg' && sort !== undefined ? (sort.kind === 'number' ? `${ph}::numeric` : sort.kind === 'boolean' ? `${ph}::boolean` : ph) : ph;
  const cur = q.after;
  if (cur != null) {
    if (sort === undefined) where.push(`s.seq > ${p(cur.key)}`);
    else if (cur.key === null) where.push(`(${key} IS NULL AND s.stream_id > ${p(cur.id)})`);
    else {
      const k1 = cast(p(cur.key));
      const k2 = cast(p(cur.key));
      where.push(`(${key} ${sort.descending ? '<' : '>'} ${k1} OR (${key} = ${k2} AND s.stream_id > ${p(cur.id)}) OR ${key} IS NULL)`);
    }
  }
  // Nulls last either way. Descending needs no IS NULL term (SQLite sorts nulls lowest), so an index on the key can give the order.
  const keyOrder = sort?.descending === true ? `${key} DESC${dialect === 'pg' ? ' NULLS LAST' : ''}` : `(${key} IS NULL) ASC, ${key} ASC`;
  const order = sort === undefined ? 's.seq ASC' : `${keyOrder}, s.stream_id ASC`;
  const sql =
    `SELECT s.stream_id AS stream_id, s.version AS version, s.state AS state, ${key} AS sort_key FROM ${table.name} s${join}` +
    ` WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${p(q.limit)} OFFSET ${p(q.offset ?? 0)}`;
  const countSql = q.after === undefined && q.count !== false ? `SELECT COUNT(*) AS n FROM ${table.name} s WHERE ${countWhere.join(' AND ')}` : null;
  return { sql, params, countSql, countParams };
}

// A page from the rows a SQL store returned for buildStateSql.
export function pageFromSql(
  q: StateQuery,
  rows: ReadonlyArray<{ stream_id: string; version: number | string; state: unknown; sort_key: unknown }>,
  total: number | null,
  parse: (state: unknown) => unknown,
): StatePage {
  const normalize = (k: unknown): StateCursor['key'] => {
    if (k === null || k === undefined) return null;
    if (q.sort === undefined || q.sort.kind === 'number') return Number(k);
    if (q.sort.kind === 'boolean') return k === true || k === 1 || k === 't' || k === '1';
    return String(k);
  };
  const last = rows.at(-1);
  return {
    states: rows.map((r) => ({ streamId: r.stream_id, version: Number(r.version), state: parse(r.state) })),
    ...(total === null ? {} : { total }),
    next: last !== undefined && rows.length === q.limit ? { key: normalize(last.sort_key), id: last.stream_id } : null,
  };
}
