import {
  changesSince,
  collectPluginObjects,
  loadConfig,
  loadPlugins,
  type Config,
  type DaemonPlugin,
  type DaemonPluginContext,
  type EventStore,
  type GuiExtensions,
  type Logger,
  type ObjectRegistration,
  type PluginRoute,
  type PluginSharedExports,
} from '@sprintster/engine';
import type { MountedObject } from './app.js';

export interface PluginModule extends PluginSharedExports {
  plugin?: DaemonPlugin;
}

// How a host finds a plugin's module by the name its config entry gives; null when the package exists but is not a daemon plugin.
export type PluginResolver = (name: string) => Promise<PluginModule | null>;

export interface MountedRoute extends PluginRoute {
  namespace: string;
}

export interface LoadedDaemonPlugins {
  objects: ObjectRegistration[];
  routes: MountedRoute[];
  extensions: GuiExtensions;
  // Full paths a client may open a WebSocket on.
  channels: string[];
}

// The host's WebSocket side: Node and the Durable Object keep their own connections and deliver to every client on a path.
export interface SocketHost {
  send(path: string, message: string): void;
}

export const consoleLogger: Logger = {
  info: (message, fields) => console.log(message, fields ?? ''),
  warn: (message, fields) => console.warn(message, fields ?? ''),
  error: (message, fields) => console.error(message, fields ?? ''),
};

// Objects a plugin contributes become part of the app config, stored and served like any configured object.
export async function withContributedObjects(config: Config, resolve: PluginResolver): Promise<Config> {
  const collected = await collectPluginObjects({ entries: config.plugins, resolveShared: resolve });
  if (collected.length === 0) return config;
  return loadConfig({ ...config, objects: [...config.objects, ...collected.flatMap((c) => c.objects)] });
}

export async function loadDaemonPlugins(opts: {
  config: Config;
  store: EventStore;
  apis: readonly MountedObject[];
  resolve: PluginResolver;
  logger?: Logger;
  sockets?: SocketHost;
}): Promise<LoadedDaemonPlugins> {
  const out: LoadedDaemonPlugins = { objects: [], routes: [], extensions: { actions: [], badges: [] }, channels: [] };
  const logger = opts.logger ?? consoleLogger;
  const base = (namespace: string) => `/plugins/${namespace}`;
  await loadPlugins<DaemonPluginContext>({
    entries: opts.config.plugins,
    logger,
    resolve: async (name) => {
      const mod = await opts.resolve(name);
      if (mod === null) throw new Error(`no module for plugin '${name}'`);
      return mod.plugin === undefined ? null : { plugin: mod.plugin };
    },
    buildContext: (_entry, namespace, config) => ({
      config,
      logger,
      objects: { register: (o) => out.objects.push(o) },
      routes: { register: (r) => out.routes.push({ ...r, namespace }) },
      channels: {
        open: (name) => {
          const path = `${base(namespace)}/channels/${name}`;
          out.channels.push(path);
          return { send: (message) => opts.sockets?.send(path, JSON.stringify(message)) };
        },
      },
      gui: {
        action: (a) => out.extensions.actions.push({ ...a, id: `${namespace}.${a.id}`, route: `${base(namespace)}${a.route}` }),
        badge: (b) => out.extensions.badges.push({ ...b, id: `${namespace}.${b.id}`, route: `${base(namespace)}${b.route}` }),
      },
      data: {
        object: (name) => {
          const mounted = opts.apis.find((m) => m.obj.name === name);
          if (mounted === undefined) throw new Error(`plugin '${namespace}' asked for unknown object '${name}'`);
          return mounted.api;
        },
        position: () => opts.store.position(),
        changesSince: (position) => changesSince(opts.store, position),
      },
    }),
  });
  return out;
}
