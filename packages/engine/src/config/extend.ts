const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(base: unknown, site: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(site)) return site;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(site)) merged[key] = key in base ? merge(base[key], value) : value;
  return merged;
}

/**
 * Layers a config file over the one it extends, as tsconfig does: plain objects
 * merge key by key, anything else (arrays included) is replaced by `site`'s
 * value. The top-level `extends` key is dropped.
 */
export function extendConfig(base: unknown, site: unknown): unknown {
  const merged = merge(base, site);
  if (isPlainObject(merged)) delete merged['extends'];
  return merged;
}
