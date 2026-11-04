import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { extendConfig } from '@sprintster/engine';

/**
 * Reads a JSON config file, following `"extends": "<path>"` (relative to the
 * file that declares it) through any chain, and merges with `extendConfig`.
 * `rebase` names top-level keys holding a path: a value starting with `./` or
 * `../` is made absolute against the file that declares it.
 */
export function readConfigFile(path: string, rebase: string[] = [], seen: string[] = []): unknown {
  const file = resolve(path);
  if (seen.includes(file)) throw new Error(`config extends itself: ${[...seen, file].join(' -> ')}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(seen.length === 0 ? why : `${file}, extended by ${seen.at(-1)}: ${why}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const config = { ...(raw as Record<string, unknown>) };
  for (const key of rebase) {
    const value = config[key];
    if (typeof value === 'string' && /^\.\.?\//.test(value)) config[key] = resolve(dirname(file), value);
  }
  const parent = config['extends'];
  if (parent === undefined) return config;
  if (typeof parent !== 'string' || parent === '') throw new Error(`${file}: "extends" must be a path`);
  const parentPath = isAbsolute(parent) ? parent : resolve(dirname(file), parent);
  return extendConfig(readConfigFile(parentPath, rebase, [...seen, file]), config);
}
