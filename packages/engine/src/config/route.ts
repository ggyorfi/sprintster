import type { ObjectConfig } from './schema.js';

// Paths the daemon mounts for itself; an object slugging to one of these would shadow it.
export const RESERVED_ROUTES: ReadonlySet<string> = new Set(['health', 'config', 'assets']);

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s_\p{P}\p{S}]+/gu, '-')
    .replace(/[^a-z0-9-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// Declared, never derived: a route is a URL contract, and deriving it from a label made renaming the label a breaking change.
export function objectRoute(obj: Pick<ObjectConfig, 'route'>): string {
  return obj.route;
}
