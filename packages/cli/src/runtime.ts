import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createBlobApi, setAppConfig, type BlobStore, type Config, type EventStore } from '@sprintster/engine';
import { buildApis, createApp, type StaticFiles } from '@sprintster/daemon';
import { runTui } from '@sprintster/tui';

export function nodeStaticFiles(root: string): StaticFiles {
  return (path) => serveStatic(path === undefined ? { root } : { path, root });
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
}): Promise<DaemonHandle> {
  setAppConfig(opts.config);
  const apis = buildApis(opts.config, opts.store);
  const blobApi = createBlobApi(opts.store, opts.blobStore);
  const app = createApp(
    opts.webRoot !== undefined ? { apis, blobApi, web: nodeStaticFiles(opts.webRoot) } : { apis, blobApi },
  );
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
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function startTui(opts: { config: Config; daemonUrl: string }): Promise<void> {
  await runTui({ daemonUrl: opts.daemonUrl, config: opts.config });
}
