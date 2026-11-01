import { formatGBP, fromPence } from '../money/index.js';
import { formatIsoMinute } from '../time/index.js';
import type { ObjectConfig, PropertyConfig } from '../config/schema.js';
import { displayText } from './locale.js';

export function formatCell(property: PropertyConfig, value: unknown, suffix = ''): string {
  if (value === null || value === undefined) return '';
  let base: string;
  switch (property.type) {
    case 'money':
      base = formatGBP(fromPence(value as string));
      break;
    case 'id':
      base = String(value).slice(0, 8);
      break;
    case 'sequence':
      base = `#${String(value)}`;
      break;
    case 'datetime':
      base = formatIsoMinute(String(value));
      break;
    case 'refs':
      base = Array.isArray(value) ? value.map(String).join(', ') : '';
      break;
    case 'image':
      base = (value as { filename?: unknown }).filename === undefined ? '' : String((value as { filename: unknown }).filename);
      break;
    case 'object':
      base = '';
      break;
    default:
      base = displayText(value);
  }
  return base === '' ? '' : base + suffix;
}

export interface ListColumnSpec {
  // The row key to read the (possibly pre-joined) value from; equals property.name for a plain column, the dotted path for a ref-traversal column.
  key: string;
  property: PropertyConfig;
  label: string;
  width: number;
  suffix: string;
  thumbnail: boolean;
}

export type ObjectResolver = (name: string) => ObjectConfig | undefined;

const DEFAULT_COLUMN_WIDTH = 12;

export function listColumns(
  obj: ObjectConfig,
  listName = 'default',
  resolveObject?: ObjectResolver,
): ListColumnSpec[] {
  const list = obj.lists.find((l) => l.name === listName) ?? obj.lists[0];
  if (list === undefined) return [];
  const byName = new Map(obj.properties.map((p) => [p.name, p]));
  return list.columns.map((col) => {
    const dot = col.property.indexOf('.');
    if (dot > 0) {
      const refName = col.property.slice(0, dot);
      const leafName = col.property.slice(dot + 1);
      const refProp = byName.get(refName);
      const target = refProp?.type === 'ref' ? resolveObject?.(refProp.target) : undefined;
      const leaf = target?.properties.find((p) => p.name === leafName);
      const property: PropertyConfig = leaf ?? { name: col.property, type: 'text' };
      return {
        key: col.property,
        property,
        label: col.label ?? leaf?.title ?? leafName,
        width: col.width ?? DEFAULT_COLUMN_WIDTH,
        suffix: col.suffix ?? '',
        thumbnail: false,
      };
    }
    const property: PropertyConfig = byName.get(col.property) ?? { name: col.property, type: 'text' };
    return {
      key: col.property,
      property,
      label: col.label ?? property.title ?? property.name,
      width: col.width ?? DEFAULT_COLUMN_WIDTH,
      suffix: col.suffix ?? '',
      thumbnail: col.thumbnail === true,
    };
  });
}

// The blob to show for an image value in a list or picker: its thumbnail when it has one, else the image itself.
export function thumbnailHash(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const { thumb, hash } = value as { thumb?: unknown; hash?: unknown };
  if (typeof thumb === 'string') return thumb;
  return typeof hash === 'string' ? hash : null;
}

export function imagePropertyOf(obj: ObjectConfig | undefined): string | null {
  return obj?.properties.find((p) => p.type === 'image')?.name ?? null;
}

// A translated value matches in any of its locales.
function searchText(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return Object.values(value).map(String).join(' ');
  return String(value ?? '');
}

export interface SearchSpec {
  fields: readonly string[];
  idPrefix?: boolean;
  idField?: string;
}

export function filterByConfig<T extends object>(
  rows: readonly T[],
  query: string,
  spec: SearchSpec,
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  const idField = spec.idField ?? 'id';
  return rows.filter((row) => {
    const r = row as Record<string, unknown>;
    const hay = spec.fields.map((f) => searchText(r[f])).join(' ').toLowerCase();
    const id = String(r[idField] ?? '').toLowerCase();
    return terms.every((t) => hay.includes(t) || (spec.idPrefix === true && id.startsWith(t)));
  });
}
