import type { ObjectConfig } from '../config/schema.js';

export interface BacklinkSource {
  object: ObjectConfig;
  field: string;
  multi: boolean;
}

// Every ref/refs field across the config that points at `targetName`.
export function backlinkSources(objects: ReadonlyArray<ObjectConfig>, targetName: string): BacklinkSource[] {
  const out: BacklinkSource[] = [];
  for (const object of objects) {
    for (const p of object.properties) {
      if ((p.type === 'ref' || p.type === 'refs') && p.target === targetName) {
        out.push({ object, field: p.name, multi: p.type === 'refs' });
      }
    }
  }
  return out;
}

export function rowReferences(
  row: Record<string, unknown>,
  field: string,
  multi: boolean,
  targetId: string,
): boolean {
  const value = row[field];
  if (value === null || value === undefined) return false;
  if (multi) return Array.isArray(value) && value.map(String).includes(targetId);
  return String(value) === targetId;
}

export interface BacklinkGroup {
  object: string;
  field: string;
  rows: Array<Record<string, unknown>>;
}

export type RowLoader = (objectName: string) => Promise<Array<Record<string, unknown>>>;

// Derived read-path list of objects referencing (targetName, targetId). `loadRows` supplies live rows (already excluding soft-deleted).
export async function findBacklinks(
  objects: ReadonlyArray<ObjectConfig>,
  targetName: string,
  targetId: string,
  loadRows: RowLoader,
): Promise<BacklinkGroup[]> {
  const sources = backlinkSources(objects, targetName);
  const cache = new Map<string, Array<Record<string, unknown>>>();
  const groups: BacklinkGroup[] = [];
  for (const src of sources) {
    let rows = cache.get(src.object.name);
    if (rows === undefined) {
      rows = await loadRows(src.object.name);
      cache.set(src.object.name, rows);
    }
    groups.push({
      object: src.object.name,
      field: src.field,
      rows: rows.filter((r) => rowReferences(r, src.field, src.multi, targetId)),
    });
  }
  return groups;
}
