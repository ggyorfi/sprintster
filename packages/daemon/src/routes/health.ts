import { Hono } from 'hono';
import { version } from '@sprintster/engine';

export const healthRoute = new Hono();

healthRoute.get('/', (c) =>
  c.json({
    status: 'ok',
    version,
    time: new Date().toISOString(),
  }),
);
