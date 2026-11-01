import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { InMemoryEventStore, loadConfig, type DaemonPlugin } from '@sprintster/engine';
import { startDaemon } from './runtime.js';

const pusher: DaemonPlugin = {
  name: 'plugin-pusher',
  namespace: 'pusher',
  version: '1',
  capabilities: [],
  config: { parse: () => ({}) } as never,
  init(ctx) {
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
};

describe('plugin channels on Node', () => {
  it('pushes a plugin message to every connected client, and refuses other paths', async () => {
    const daemon = await startDaemon({
      config: loadConfig({ version: '1', objects: [], plugins: [{ name: 'plugin-pusher' }] }),
      store: new InMemoryEventStore(),
      blobStore: undefined as never,
      host: '127.0.0.1',
      port: 3977,
      resolvePlugin: async () => ({ plugin: pusher }),
    });
    try {
      const ws = new WebSocket('ws://127.0.0.1:3977/plugins/pusher/channels/news');
      await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
      const received = new Promise<string>((resolve) => ws.once('message', (data) => resolve(String(data))));
      await fetch('http://127.0.0.1:3977/plugins/pusher/say', { method: 'POST' });
      expect(JSON.parse(await received)).toEqual({ type: 'hello' });
      ws.close();

      const stray = new WebSocket('ws://127.0.0.1:3977/plugins/pusher/channels/other');
      await expect(new Promise((resolve, reject) => stray.once('open', resolve).once('error', reject))).rejects.toThrow();
    } finally {
      await daemon.close();
    }
  });
});
