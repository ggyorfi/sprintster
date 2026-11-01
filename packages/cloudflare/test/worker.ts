import type { PluginModule } from '@sprintster/daemon';
import { createWorker } from '../src/index.js';

export const ping: PluginModule = {
  plugin: {
    name: 'plugin-ping',
    namespace: 'ping',
    version: '1',
    capabilities: [],
    config: { parse: () => ({}) } as never,
    init(ctx) {
      ctx.routes.register({ method: 'GET', path: '/pong', handler: async () => Response.json({ position: await ctx.data.position() }) });
      ctx.gui.badge({ id: 'pong', route: '/pong' });
      const channel = ctx.channels.open('news');
      ctx.routes.register({
        method: 'POST',
        path: '/say',
        handler: async () => {
          channel.send({ type: 'hello' });
          return Response.json({ message: 'sent' });
        },
      });
    },
  },
};

const { App, worker } = createWorker({
  app: {
    version: '1',
    objects: [
      {
        name: 'note',
        title: 'Note',
        titlePlural: 'Notes',
        route: 'notes',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'title', title: 'Title', type: 'text' },
          { name: 'removed', type: 'boolean', system: true },
        ],
      },
    ],
    plugins: [{ name: 'plugin-ping' }],
  },
}, { plugins: { 'plugin-ping': ping } });

export { App };
export default worker;
