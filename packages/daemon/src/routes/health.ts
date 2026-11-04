import { Hono } from 'hono';
import { appConfig, version } from '@sprintster/engine';

export const healthRoute = new Hono();

healthRoute.get('/', (c) =>
  c.json({
    status: 'ok',
    version,
    time: new Date().toISOString(),
    // Public, so the web GUI learns where to log in before it can read /config (ADR 14).
    ...(appConfig.auth === undefined ? {} : { auth: appConfig.auth }),
  }),
);
