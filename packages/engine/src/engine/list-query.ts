import { BadRequestError } from '../errors/api-error.js';
import type { ObjectConfig, PropertyConfig } from '../config/schema.js';
import { readPath, searchTerms, type SortKind, type StateCondition, type StateCursor, type StateQuery, type StateSort } from '../events/query.js';
import type { FilterOptionConfig, ListConfig } from '../config/schema.js';
import { lifecycleInfo } from './lifecycle.js';

// ADR 24.
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 100;

export interface ListParams {
  q?: string;
  sort?: string;
  fields?: readonly string[];
  // Only these records, at most a page of them.
  ids?: readonly string[];
  list?: string;
  limit?: number;
  offset?: number;
  after?: string;
  // False: no `total`, for a page after the first.
  count?: boolean;
  // ADR 27: `<filter label>:<option label>`, one per filter group.
  filter?: readonly string[];
}

export interface ListPage<T = Record<string, unknown>> {
  rows: T[];
  total?: number;
  next: string | null;
}

export function encodeCursor(cursor: StateCursor | null): string | null {
  if (cursor === null) return null;
  const bytes = new TextEncoder().encode(JSON.stringify([cursor.key, cursor.id]));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(token: string): StateCursor {
  try {
    const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const [key, id] = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as [StateCursor['key'], string];
    if (typeof id !== 'string') throw new Error('bad cursor');
    return { key, id };
  } catch {
    throw new BadRequestError('after is not a cursor this API returned');
  }
}

function sortKind(prop: PropertyConfig): SortKind | null {
  switch (prop.type) {
    case 'id':
    case 'text':
    case 'markdown':
    case 'code':
    case 'enum':
    case 'date':
    case 'datetime':
    case 'ref':
      return 'text';
    case 'integer':
    case 'money':
    case 'sequence':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'refs':
    case 'image':
    case 'file':
    case 'object':
    case 'array':
      return null;
  }
}

function valuePath(prop: PropertyConfig, locales: readonly string[]): string {
  const translated = (prop.type === 'text' || prop.type === 'markdown') && prop.translated === true;
  return translated && locales[0] !== undefined ? `${prop.name}.${locales[0]}` : prop.name;
}

// A list sort key: a property (`title`, `-publishedAt`), or a ref's field (`section.title`).
// Newest first, unless a list or a request asks for another order.
export const DEFAULT_SORT = '-createdAt';

export function resolveSort(obj: ObjectConfig, key: string, objects: readonly ObjectConfig[], locales: readonly string[]): StateSort {
  const descending = key.startsWith('-');
  const [name, field, ...rest] = (descending ? key.slice(1) : key).split('.');
  if ((name === 'createdAt' || name === 'updatedAt') && field === undefined) return { path: name, kind: 'text', descending };
  const prop = obj.properties.find((p) => p.name === name);
  if (prop === undefined || rest.length > 0) throw new BadRequestError(`cannot sort '${obj.name}' by '${key}'`);
  if (field === undefined) {
    const kind = sortKind(prop);
    if (kind === null) throw new BadRequestError(`cannot sort '${obj.name}' by '${key}': a ${prop.type} has no order`);
    return { path: valuePath(prop, locales), kind, descending };
  }
  if (prop.type === 'object') {
    const inner = prop.properties.find((p) => p.name === field);
    const innerKind = inner === undefined ? null : sortKind(inner);
    if (inner === undefined || innerKind === null) throw new BadRequestError(`cannot sort '${obj.name}' by '${key}'`);
    return { path: `${prop.name}.${valuePath(inner, locales)}`, kind: innerKind, descending };
  }
  if (prop.type !== 'ref') throw new BadRequestError(`cannot sort '${obj.name}' by '${key}': '${name}' is not a ref`);
  const target = objects.find((o) => o.name === prop.target);
  const targetProp = target?.properties.find((p) => p.name === field);
  const kind = targetProp === undefined ? null : sortKind(targetProp);
  if (targetProp === undefined || kind === null) throw new BadRequestError(`cannot sort '${obj.name}' by '${key}'`);
  return { path: prop.name, kind, descending, ref: { streamType: prop.target, path: valuePath(targetProp, locales) } };
}

const FILE_FIELDS = new Set(['contentType', 'filename', 'size']);

// ADR 27: why a filter option's path or test is wrong, or null.
export function filterOptionProblem(obj: ObjectConfig, option: FilterOptionConfig): string | null {
  const tests = (['equals', 'notEquals', 'startsWith', 'notStartsWith'] as const).filter((t) => option[t] !== undefined);
  if (tests.length !== 1) return `needs exactly one of equals, notEquals, startsWith, notStartsWith`;
  const [name, field] = option.property.split('.');
  const prop = obj.properties.find((p) => p.name === name);
  if (prop === undefined) return `'${option.property}' is not a property`;
  if (field === undefined) return null;
  if (prop.type === 'object' && prop.properties.some((p) => p.name === field)) return null;
  if ((prop.type === 'image' || prop.type === 'file') && FILE_FIELDS.has(field)) return null;
  return `'${option.property}' is not a field a filter can read`;
}

function filterCondition(option: FilterOptionConfig): StateCondition {
  if (option.equals !== undefined) return { path: option.property, op: 'equals', value: option.equals };
  if (option.notEquals !== undefined) return { path: option.property, op: 'notEquals', value: option.notEquals };
  if (option.startsWith !== undefined) return { path: option.property, op: 'startsWith', value: option.startsWith };
  return { path: option.property, op: 'notStartsWith', value: option.notStartsWith ?? '' };
}

function resolveFilters(list: ListConfig | undefined, names: readonly string[]): StateCondition[] {
  const groups = new Set<string>();
  return names.map((name) => {
    const at = name.indexOf(':');
    const [group, label] = at < 0 ? [name, ''] : [name.slice(0, at), name.slice(at + 1)];
    const option = list?.filters?.find((f) => f.label === group)?.options.find((o) => o.label === label);
    if (option === undefined) throw new BadRequestError(`no filter '${name}'`);
    if (groups.has(group)) throw new BadRequestError(`filter '${group}' given twice`);
    groups.add(group);
    return filterCondition(option);
  });
}

export function searchFieldsOf(obj: ObjectConfig): string[] {
  return [...new Set(obj.lists.flatMap((l) => l.search?.fields ?? []))];
}

export function toStateQuery(
  obj: ObjectConfig,
  params: ListParams,
  objects: readonly ObjectConfig[],
  locales: readonly string[],
): Omit<StateQuery, 'partitionId' | 'streamType'> {
  const limit = params.limit ?? DEFAULT_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new BadRequestError(`limit must be between 1 and ${MAX_PAGE}`);
  if (params.offset !== undefined && params.after !== undefined) throw new BadRequestError('offset and after cannot be combined');
  if (params.offset !== undefined && (!Number.isInteger(params.offset) || params.offset < 0)) throw new BadRequestError('offset must be a non-negative integer');
  const list = params.list === undefined ? obj.lists[0] : obj.lists.find((l) => l.name === params.list);
  if (params.list !== undefined && list === undefined) throw new BadRequestError(`'${obj.name}' has no list '${params.list}'`);
  const sortKey = params.sort ?? list?.sort ?? DEFAULT_SORT;
  const { kind, field } = lifecycleInfo(obj);
  const terms = searchTerms(params.q);
  if (params.ids !== undefined && params.ids.length > MAX_PAGE) throw new BadRequestError(`at most ${MAX_PAGE} ids`);
  return {
    limit,
    ...(params.ids === undefined ? {} : { ids: params.ids }),
    ...(params.count === false ? { count: false } : {}),
    ...(params.filter === undefined || params.filter.length === 0 ? {} : { where: resolveFilters(list, params.filter) }),
    ...(terms.length === 0 ? {} : { terms, idPrefix: list?.search?.idPrefix === true }),
    ...(sortKey === undefined ? {} : { sort: resolveSort(obj, sortKey, objects, locales) }),
    ...(kind === 'softDelete' && field !== null ? { hide: field } : {}),
    ...(params.after !== undefined ? { after: decodeCursor(params.after) } : { offset: params.offset ?? 0 }),
  };
}

export type TargetStates = (streamType: string, ids: readonly string[]) => Promise<Map<string, unknown>>;

// ADR 24: only the asked fields; `section.title` carries the referenced value, `<ref>#thumb` the referenced image.
export async function projectRows(
  obj: ObjectConfig,
  states: readonly unknown[],
  fields: readonly string[] | undefined,
  objects: readonly ObjectConfig[],
  targets: TargetStates,
): Promise<Array<Record<string, unknown>>> {
  const rows = states as Array<Record<string, unknown>>;
  if (fields === undefined) return rows;
  const refOf = (f: string) => (f.endsWith('#thumb') ? f.slice(0, -'#thumb'.length) : f.includes('.') ? f.slice(0, f.indexOf('.')) : null);
  const byTarget = new Map<string, Set<string>>();
  for (const f of fields) {
    const ref = refOf(f);
    if (ref === null) continue;
    const prop = obj.properties.find((p) => p.name === ref);
    if (prop?.type === 'object' && !f.endsWith('#thumb')) continue;
    if (prop?.type !== 'ref' && prop?.type !== 'refs') throw new BadRequestError(`'${f}' is not a field of '${obj.name}'`);
    const ids = byTarget.get(prop.target) ?? new Set<string>();
    for (const r of rows) for (const id of [r[ref]].flat()) if (typeof id === 'string') ids.add(id);
    byTarget.set(prop.target, ids);
  }
  const loaded = new Map<string, Map<string, unknown>>();
  for (const [target, ids] of byTarget) loaded.set(target, await targets(target, [...ids]));
  return rows.map((r) => {
    const out: Record<string, unknown> = { id: r['id'] };
    for (const f of fields) {
      const name = refOf(f) ?? f;
      const prop = obj.properties.find((p) => p.name === name);
      if (prop === undefined) throw new BadRequestError(`'${f}' is not a field of '${obj.name}'`);
      out[name] = r[name] ?? null;
      if (prop.type === 'object' && name !== f) out[f] = readPath(r, f) ?? null;
      if (name === f || (prop.type !== 'ref' && prop.type !== 'refs')) continue;
      const first = [r[name]].flat()[0];
      const target = typeof first === 'string' ? loaded.get(prop.target)?.get(first) : undefined;
      if (f.endsWith('#thumb')) {
        const image = objects.find((o) => o.name === prop.target)?.properties.find((p) => p.type === 'image')?.name;
        out[f] = target === undefined || image === undefined ? null : (readPath(target, image) ?? null);
      } else out[f] = target === undefined ? null : (readPath(target, f.slice(f.indexOf('.') + 1)) ?? null);
    }
    return out;
  });
}
