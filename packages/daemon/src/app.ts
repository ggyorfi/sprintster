import { Hono, type MiddlewareHandler } from 'hono';
import {
  appConfig,
  changesSince,
  objectRoute,
  rebuildObjectStates,
  type EventInput,
  type BlobApi,
  type EventStore,
  type ObjectConfig,
  type PluginObjectApi,
} from '@sprintster/engine';
import type { LoadedDaemonPlugins } from './plugins.js';
import { healthRoute } from './routes/health.js';
import { createObjectRoute } from './routes/object.js';
import { createAssetRoute, type AssetHashResolver } from './routes/asset.js';

export interface MountedObject {
  api: PluginObjectApi<{ id: string }>;
  obj: ObjectConfig;
}

// Serves the requested static file, or the named one when given a path. Supplied by the runtime, so the app imports nothing platform specific.
export type StaticFiles = (path?: string) => MiddlewareHandler;

export interface AppDeps {
  apis: ReadonlyArray<MountedObject>;
  blobApi?: BlobApi;
  web?: StaticFiles;
  store?: EventStore;
  plugins?: LoadedDaemonPlugins;
}

// A client-side route has no file extension on its last segment; a missing asset does.
function looksLikeFile(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('.');
}

// The nominated assets object holds its file in exactly one image property (loadConfig enforces that), so /assets/<id> reads the hash from there.
function assetHashResolver(deps: AppDeps): AssetHashResolver | undefined {
  const named = appConfig.assets;
  if (named === undefined) return undefined;
  const mounted = deps.apis.find((d) => d.obj.name === named);
  const file = mounted?.obj.properties.find((p) => p.type === 'image');
  if (mounted === undefined || file === undefined) return undefined;
  const lifecycle = mounted.obj.lifecycle;
  const removedField = lifecycle !== undefined && 'softDelete' in lifecycle ? lifecycle.softDelete : undefined;
  return async (id) => {
    const row = (await mounted.api.get(id)) as Record<string, unknown> | null;
    if (row === null) return null;
    if (removedField !== undefined && row[removedField] === true) return null;
    const value = row[file.name];
    if (value === null || typeof value !== 'object') return null;
    const hash = (value as { hash?: unknown }).hash;
    return typeof hash === 'string' ? hash : null;
  };
}

// A path whose first segment is a mounted API namespace can never be a client-side route.
function claimedByApi(path: string, apiRoots: ReadonlySet<string>): boolean {
  const first = path.split('/')[1] ?? '';
  if (!apiRoots.has(first)) return false;
  return first !== 'assets' || !looksLikeFile(path);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const apis: MountedObject[] = [...deps.apis, ...(deps.plugins?.objects ?? []).map(({ config, api }) => ({ obj: config, api }))];
  app.route('/health', healthRoute);
  app.get('/config', (c) =>
    c.json({
      version: appConfig.version,
      ...(appConfig.title === undefined ? {} : { title: appConfig.title }),
      ...(appConfig.locales === undefined ? {} : { locales: appConfig.locales }),
      theme: appConfig.theme,
      objects: apis.map((d) => d.obj),
      ...(appConfig.assets === undefined ? {} : { assets: appConfig.assets }),
      ...(deps.plugins === undefined ? {} : { extensions: deps.plugins.extensions }),
    }),
  );
  for (const { api, obj } of apis) {
    app.route(`/${objectRoute(obj)}`, createObjectRoute(api, obj));
  }
  const apiRoots = new Set(['health', 'config', 'plugins', ...apis.map(({ obj }) => objectRoute(obj))]);
  if (deps.store !== undefined) {
    const store = deps.store;
    app.get('/log', async (c) => {
      const since = Number(c.req.query('since') ?? '0');
      if (!Number.isInteger(since) || since < 0) {
        return c.json({ code: 'bad_request', message: 'since must be a non-negative integer position' }, 400);
      }
      const [position, changes] = await Promise.all([store.position(), changesSince(store, since)]);
      return c.json({ position, changes });
    });
    // Appends exported events as they are, for moving an app to another store. `after` must be the log's position,
    // so two imports cannot interleave and a retried batch is refused rather than doubled.
    app.post('/log', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { after?: unknown; events?: unknown } | null;
      if (body === null || typeof body.after !== 'number' || !Array.isArray(body.events)) {
        return c.json({ code: 'bad_request', message: 'expected { after: number, events: EventInput[] }' }, 400);
      }
      const position = await store.position();
      if (position !== body.after) {
        return c.json({ code: 'conflict', message: `the log is at ${position}, not ${body.after}`, position }, 409);
      }
      const events = body.events as EventInput[];
      for (const event of events) await store.append(event);
      const touched = new Set(events.map((e) => e.streamType));
      for (const { obj } of deps.apis) if (touched.has(obj.name)) await rebuildObjectStates(store, obj);
      return c.json({ position: await store.position() });
    });
    apiRoots.add('log');
  }
  for (const r of deps.plugins?.routes ?? []) {
    app.on(r.method, `/plugins/${r.namespace}${r.path}`, (c) => r.handler(c.req.raw, c.req.param() as Record<string, string>));
  }
  if (deps.blobApi !== undefined) {
    app.route('/assets', createAssetRoute(deps.blobApi, assetHashResolver({ ...deps, apis })));
    apiRoots.add('assets');
  }
  app.use('/*', async (c, next) => {
    if (!claimedByApi(c.req.path, apiRoots)) return next();
    return c.json({ code: 'not_found', message: `no route for ${c.req.method} ${c.req.path}` }, 404);
  });
  if (deps.web !== undefined) {
    const web = deps.web;
    app.use('/*', web());
    app.get('*', async (c, next) => {
      if (looksLikeFile(c.req.path)) return next();
      return web('index.html')(c, next);
    });
  }
  return app;
}
