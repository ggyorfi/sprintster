import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { appConfig, objectRoute, type BlobApi, type ObjectConfig, type PluginObjectApi } from '@sprintster/engine';
import { healthRoute } from './routes/health.js';
import { createObjectRoute } from './routes/object.js';
import { createAssetRoute, type AssetHashResolver } from './routes/asset.js';

export interface MountedObject {
  api: PluginObjectApi<{ id: string }>;
  obj: ObjectConfig;
}

export interface AppDeps {
  apis: ReadonlyArray<MountedObject>;
  blobApi?: BlobApi;
  webRoot?: string;
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
  app.route('/health', healthRoute);
  app.get('/config', (c) =>
    c.json({
      version: appConfig.version,
      theme: appConfig.theme,
      objects: deps.apis.map((d) => d.obj),
      ...(appConfig.assets === undefined ? {} : { assets: appConfig.assets }),
    }),
  );
  for (const { api, obj } of deps.apis) {
    app.route(`/${objectRoute(obj)}`, createObjectRoute(api, obj));
  }
  const apiRoots = new Set(['health', 'config', ...deps.apis.map(({ obj }) => objectRoute(obj))]);
  if (deps.blobApi !== undefined) {
    app.route('/assets', createAssetRoute(deps.blobApi, assetHashResolver(deps)));
    apiRoots.add('assets');
  }
  app.use('/*', async (c, next) => {
    if (!claimedByApi(c.req.path, apiRoots)) return next();
    return c.json({ code: 'not_found', message: `no route for ${c.req.method} ${c.req.path}` }, 404);
  });
  if (deps.webRoot !== undefined) {
    const root = deps.webRoot;
    app.use('/*', serveStatic({ root }));
    app.get('*', async (c, next) => {
      if (looksLikeFile(c.req.path)) return next();
      return serveStatic({ path: 'index.html', root })(c, next);
    });
  }
  return app;
}
