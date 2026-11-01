import {
  appConfig,
  listColumns,
  toInput,
  arrayInitialValues,
  displayText,
  imagePropertyOf,
  isTranslated,
  translatedInputs,
  isNetworkError,
  isApiError,
  type ApiClient,
  type ObjectConfig,
  type ObjectResolver,
  type ViewFieldSpec,
  type ViewMode,
} from '@sprintster/engine';
import type { PillTone } from '../ui/index.js';

export type Row = Record<string, unknown>;

export function makeResolveObject(objects: ReadonlyArray<ObjectConfig> = appConfig.objects): ObjectResolver {
  const byName = new Map(objects.map((o) => [o.name, o]));
  return (name) => byName.get(name);
}

const STATUS_TONES: Record<string, PillTone> = {
  live: 'info',
  sent: 'info',
  draft: 'muted',
  cancelled: 'muted',
  paid: 'success',
  replied: 'success',
  removed: 'danger',
};

export function statusTone(value: string): PillTone {
  return STATUS_TONES[value] ?? 'neutral';
}

export function formatError(err: unknown): string {
  if (isNetworkError(err)) return 'Cannot reach the server.';
  if (isApiError(err)) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function firstLabelField(obj: ObjectConfig): string {
  const p = obj.properties.find((x) => x.type !== 'id' && x.type !== 'sequence' && x.system !== true);
  return p?.name ?? 'id';
}

export function primaryLabel(obj: ObjectConfig, row: Row): string {
  const col = listColumns(obj, 'default').find((c) => c.property.type !== 'id');
  const key = col?.key ?? 'id';
  return displayText(row[key] ?? row['id']);
}

export function readPath(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Row)[seg];
  }, row);
}

// Where a list row keeps the image a ref or refs thumbnail column shows, beside the ids it was read from.
export function thumbKey(key: string): string {
  return `${key}#thumb`;
}

export async function enrichRefColumns(
  api: ApiClient,
  obj: ObjectConfig,
  resolveObject: ObjectResolver,
  rows: Row[],
): Promise<Row[]> {
  const cols = listColumns(obj, 'default', resolveObject);
  const dotted = cols.map((c) => c.key).filter((k) => k.includes('.'));
  const thumbs = cols.filter((c) => c.thumbnail && (c.property.type === 'ref' || c.property.type === 'refs'));
  if (dotted.length === 0 && thumbs.length === 0) return rows;

  const refNames = [...new Set([...dotted.map((k) => k.slice(0, k.indexOf('.'))), ...thumbs.map((c) => c.key)])];
  const indexByRef = new Map<string, Map<string, Row>>();
  const listByTarget = new Map<string, Promise<Row[]>>();
  for (const refName of refNames) {
    const prop = obj.properties.find((p) => p.name === refName);
    if (prop?.type !== 'ref' && prop?.type !== 'refs') continue;
    if (!listByTarget.has(prop.target)) listByTarget.set(prop.target, api.object<Row>(prop.target).list());
    const list = await listByTarget.get(prop.target)!;
    indexByRef.set(refName, new Map(list.map((r) => [String(r.id), r])));
  }

  return rows.map((r) => {
    const copy: Row = { ...r };
    for (const key of dotted) {
      const dot = key.indexOf('.');
      const refName = key.slice(0, dot);
      const leaf = key.slice(dot + 1);
      const target = indexByRef.get(refName)?.get(String(r[refName]));
      copy[key] = target ? readPath(target, leaf) : null;
    }
    for (const col of thumbs) {
      if (col.property.type !== 'ref' && col.property.type !== 'refs') continue;
      const image = imagePropertyOf(resolveObject(col.property.target));
      const value = r[col.key];
      const first = Array.isArray(value) ? value[0] : value;
      const target = indexByRef.get(col.key)?.get(String(first));
      copy[thumbKey(col.key)] = target !== undefined && image !== null ? target[image] : null;
    }
    return copy;
  });
}

export function initInputs(
  specs: ViewFieldSpec[],
  mode: ViewMode,
  initial: Row | null,
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const spec of specs) {
    if (spec.property.type === 'array') {
      const value = mode === 'create' || initial === null ? [] : (readPath(initial, spec.path) ?? []);
      Object.assign(inputs, arrayInitialValues(spec.property, spec.path, value));
    } else if (spec.derivedFromRef !== null) {
      inputs[spec.path] = '';
    } else if (isTranslated(spec.property)) {
      Object.assign(inputs, translatedInputs(spec.path, initial === null || mode === 'create' ? null : readPath(initial, spec.path)));
    } else if (mode === 'create' || initial === null) {
      inputs[spec.path] = spec.defaultInput;
    } else {
      inputs[spec.path] = toInput(spec.property, readPath(initial, spec.path) ?? null);
    }
  }
  return inputs;
}
