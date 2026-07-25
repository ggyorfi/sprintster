import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { appConfig, objectRoute, type BlobApi, type ObjectConfig, type PluginObjectApi } from '@sprintster/engine';
import { healthRoute } from './routes/health.js';
import { createObjectRoute } from './routes/object.js';
import { createAssetRoute } from './routes/asset.js';

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

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route('/health', healthRoute);
  app.get('/config', (c) =>
    c.json({
      version: appConfig.version,
      theme: appConfig.theme,
      objects: deps.apis.map((d) => d.obj),
    }),
  );
  for (const { api, obj } of deps.apis) {
    app.route(`/${objectRoute(obj)}`, createObjectRoute(api, obj));
  }
  if (deps.blobApi !== undefined) {
    app.route('/assets', createAssetRoute(deps.blobApi));
  }
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
