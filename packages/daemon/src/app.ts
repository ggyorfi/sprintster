import { Hono } from 'hono';
import { appConfig, type ObjectConfig, type PluginObjectApi } from '@sprintster/engine';
import { healthRoute } from './routes/health.js';
import { createObjectRoute } from './routes/object.js';

export interface MountedObject {
  api: PluginObjectApi<{ id: string }>;
  obj: ObjectConfig;
}

export interface AppDeps {
  apis: ReadonlyArray<MountedObject>;
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
    app.route(`/${obj.titlePlural.toLowerCase()}`, createObjectRoute(api, obj));
  }
  return app;
}
