import type { ObjectConfig, PluginEntry } from '../config/schema.js';
import type { Logger, PluginContext, PluginManifest } from './types.js';

export interface PluginSharedExports {
  contributedObjects?: ReadonlyArray<ObjectConfig>;
}

export interface PluginObjectCollectorOptions {
  entries: ReadonlyArray<PluginEntry>;
  resolveShared(packageName: string): Promise<PluginSharedExports | null>;
}

export interface CollectedPluginObjects {
  pluginName: string;
  namespace: string;
  objects: ReadonlyArray<ObjectConfig>;
}

export async function collectPluginObjects(
  options: PluginObjectCollectorOptions,
): Promise<CollectedPluginObjects[]> {
  const out: CollectedPluginObjects[] = [];
  for (const entry of options.entries) {
    if (entry.enabled === false) continue;
    let mod: PluginSharedExports | null;
    try {
      mod = await options.resolveShared(entry.name);
    } catch {
      continue;
    }
    if (mod === null) continue;
    const objs = mod.contributedObjects ?? [];
    if (objs.length === 0) continue;
    out.push({ pluginName: entry.name, namespace: deriveNamespace(entry.name), objects: objs });
  }
  return out;
}

export function isMissingHostEntry(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
}

export function deriveNamespace(packageName: string, override?: string): string {
  if (override !== undefined && override.length > 0) return override;
  const m = /^(?:@[^/]+\/)?(?:plugin-)?(.+)$/.exec(packageName);
  return m?.[1] ?? packageName;
}

export interface PluginLoaderOptions<Ctx extends PluginContext> {
  entries: ReadonlyArray<PluginEntry>;
  resolve(packageName: string): Promise<{ plugin: PluginManifest<Ctx> } | null>;
  buildContext(entry: PluginEntry, namespace: string, validatedConfig: unknown): Ctx;
  logger: Logger;
}

export interface LoadedPlugin<Ctx extends PluginContext> {
  manifest: PluginManifest<Ctx>;
  namespace: string;
  ctx: Ctx;
}

export async function loadPlugins<Ctx extends PluginContext>(
  options: PluginLoaderOptions<Ctx>,
): Promise<LoadedPlugin<Ctx>[]> {
  const loaded: LoadedPlugin<Ctx>[] = [];
  const seenNamespaces = new Set<string>();
  for (const entry of options.entries) {
    if (entry.enabled === false) continue;
    let mod: { plugin: PluginManifest<Ctx> } | null;
    try {
      mod = await options.resolve(entry.name);
    } catch (err) {
      options.logger.error(`failed to load plugin '${entry.name}'`, { err: String(err) });
      continue;
    }
    if (mod === null) continue;
    const manifest = mod.plugin;
    const namespace = deriveNamespace(manifest.name, manifest.namespace);
    if (seenNamespaces.has(namespace)) {
      throw new Error(`plugin namespace collision: '${namespace}' from '${entry.name}'`);
    }
    seenNamespaces.add(namespace);
    let validatedConfig: unknown;
    try {
      validatedConfig = manifest.config.parse(entry.config ?? {});
    } catch (err) {
      throw new Error(`plugin '${entry.name}' config is invalid: ${String(err)}`);
    }
    const ctx = options.buildContext(entry, namespace, validatedConfig);
    await manifest.init(ctx);
    loaded.push({ manifest, namespace, ctx });
  }
  return loaded;
}
