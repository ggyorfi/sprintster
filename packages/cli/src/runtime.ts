import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createBlobApi, setAppConfig, type BlobStore, type Config, type EventStore } from '@sprintster/engine';
import {
  buildApis,
  createApp,
  loadDaemonPlugins,
  withContributedObjects,
  type PluginModule,
  type PluginResolver,
  type SocketHost,
  type StaticFiles,
} from '@sprintster/daemon';
import { runTui } from '@sprintster/tui';

export function nodeStaticFiles(root: string): StaticFiles {
  return (path) => serveStatic(path === undefined ? { root } : { path, root });
}

// A plugin is a package installed in the project, so it resolves from the project's own node_modules, not the CLI's.
export function nodePluginResolver(projectDir: string): PluginResolver {
  const require = createRequire(join(projectDir, 'package.json'));
  return async (name) => (await import(pathToFileURL(require.resolve(name)).href)) as PluginModule;
}

export interface DaemonHandle {
  close(): Promise<void>;
}

export async function startDaemon(opts: {
  config: Config;
  store: EventStore;
  blobStore: BlobStore;
  host: string;
  port: number;
  webRoot?: string;
  resolvePlugin?: PluginResolver;
}): Promise<DaemonHandle> {
  const resolve = opts.resolvePlugin ?? nodePluginResolver(process.cwd());
  const config = await withContributedObjects(opts.config, resolve);
  setAppConfig(config);
  const apis = buildApis(config, opts.store);
  const blobApi = createBlobApi(opts.store, opts.blobStore);
  const clients = new Map<string, Set<WebSocket>>();
  const sockets: SocketHost = {
    send: (path, message) => clients.get(path)?.forEach((ws) => ws.send(message)),
  };
  const plugins = await loadDaemonPlugins({ config, store: opts.store, apis, resolve, sockets });
  const wss = new WebSocketServer({ noServer: true });
  const base = { apis, blobApi, store: opts.store, plugins };
  const app = createApp(opts.webRoot !== undefined ? { ...base, web: nodeStaticFiles(opts.webRoot) } : base);
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: opts.host, port: opts.port }, () => resolve(s));
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `port ${opts.port} on ${opts.host} is already in use; change server.port in sprintster.config.json or stop the process using it`,
          ),
        );
      } else {
        reject(err);
      }
    });
  });
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://daemon').pathname;
    if (!plugins.channels.includes(path)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const set = clients.get(path) ?? new Set<WebSocket>();
      clients.set(path, set.add(ws));
      ws.on('close', () => set.delete(ws));
    });
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((ws) => ws.terminate());
        server.close(() => resolve());
      }),
  };
}

export async function startTui(opts: { config: Config; daemonUrl: string }): Promise<void> {
  await runTui({ daemonUrl: opts.daemonUrl, config: opts.config });
}
