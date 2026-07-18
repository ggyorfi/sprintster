import { serve } from '@hono/node-server';
import {
  createObjectApi,
  setAppConfig,
  type Config,
  type EventStore,
  type PluginObjectApi,
} from '@sprintster/engine';
import { createApp } from '@sprintster/daemon';
import { runTui } from '@sprintster/tui';

export function buildApis(config: Config, store: EventStore) {
  const apiByName: Record<string, PluginObjectApi<{ id: string }>> = {};
  const resolveTarget = (name: string): PluginObjectApi<{ id: string }> | undefined => apiByName[name];
  return config.objects.map((obj) => {
    const api = createObjectApi<{ id: string }>(store, obj, { resolveTarget });
    apiByName[obj.name] = api;
    return { obj, api };
  });
}

export interface DaemonHandle {
  close(): Promise<void>;
}

export async function startDaemon(opts: {
  config: Config;
  store: EventStore;
  host: string;
  port: number;
}): Promise<DaemonHandle> {
  setAppConfig(opts.config);
  const app = createApp({ apis: buildApis(opts.config, opts.store) });
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
