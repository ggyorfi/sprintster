import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import {
  ACTOR_HEADER,
  buildApis,
  createApp,
  loadDaemonPlugins,
  publicRouteMatcher,
  withContributedObjects,
  type PluginModule,
  type SocketHost,
  type StaticFiles,
} from '@sprintster/daemon';
import { createBlobApi, loadConfig, setAppConfig } from '@sprintster/engine';
import {
  createDurableObjectEventStore,
  createR2BlobStore,
  type DurableObjectSqlStorage,
  type R2BucketLike,
} from '@sprintster/storage-cloudflare';

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

// A public site in front of the app's bucket reads blobs with the same key scheme (ADR 23).
export { createR2BlobStore, type R2BucketLike };

// The bindings the project's wrangler config declares, typed by the slice used so the package needs no Workers type definitions.
export interface SprintsterEnv {
  APP: { idFromName(name: string): unknown; get(id: unknown): Fetcher };
  BLOBS: R2BucketLike;
  ASSETS: Fetcher;
  SPRINTSTER_USER?: string;
  SPRINTSTER_PASSWORD?: string;
}

// Files Cloudflare already serves never reach the Worker; this answers the requests that do, including the SPA fallback to index.html.
function assetFiles(assets: Fetcher): StaticFiles {
  return (path) => async (c, next) => {
    const url = new URL(c.req.url);
    if (path !== undefined) url.pathname = `/${path}`;
    const res = await assets.fetch(new Request(url, { method: c.req.method, headers: c.req.raw.headers }));
    if (res.status === 404) return next();
    return res;
  };
}

interface HibernatableSocket {
  send(message: string): void;
}

// The slice of DurableObjectState used here; accepting sockets through it lets the object hibernate while they stay open.
export interface AppState {
  storage: DurableObjectSqlStorage;
  acceptWebSocket(socket: unknown, tags?: string[]): void;
  getWebSockets(tag?: string): HibernatableSocket[];
}

type SocketPair = new () => { 0: unknown; 1: unknown };

export interface SprintsterWorker {
  // The Durable Object class; the project's Worker module exports it under the name its wrangler config binds as APP.
  App: new (state: AppState, env: SprintsterEnv) => Fetcher;
  worker: { fetch(request: Request, env: SprintsterEnv): Promise<Response> };
  // True for a request to a route a plugin declares public; a gate wrapping `worker` lets those through too.
  isPublic(request: Request): boolean;
}

export interface WorkerOptions {
  // A Worker cannot import a package by name at runtime, so each plugin the config lists is passed in under that name.
  plugins?: Record<string, PluginModule>;
  // ADR 20: a gate wrapping `worker` strips a client's Sprintster-Actor header and sets its own; without this the Worker strips it.
  trustActor?: boolean;
}

// One app per Worker: every request goes to the same Durable Object, whose SQLite storage holds the event log.
export function createWorker(projectConfig: { app: unknown }, opts: WorkerOptions = {}): SprintsterWorker {
  const base = loadConfig(projectConfig.app);
  const modules = opts.plugins ?? {};
  const missing = base.plugins.filter((p) => p.enabled !== false && modules[p.name] === undefined).map((p) => p.name);
  if (missing.length > 0) {
    throw new Error(`createWorker: the config lists plugins with no module passed in: ${missing.join(', ')}`);
  }
  const resolve = async (name: string) => modules[name] ?? null;
  const isPublic = publicRouteMatcher(base.plugins, modules);

  class App {
    readonly #app;
    readonly #state: AppState;
    #channels: string[] = [];

    constructor(state: AppState, env: SprintsterEnv) {
      this.#state = state;
      const sockets: SocketHost = {
        send: (path, message) => state.getWebSockets(path).forEach((ws) => ws.send(message)),
      };
      this.#app = (async () => {
        const config = await withContributedObjects(base, resolve);
        setAppConfig(config);
        const store = createDurableObjectEventStore(state.storage);
        const apis = buildApis(config, store);
        const vars = env as unknown as Record<string, unknown>;
        const secret = (name: string) => (typeof vars[name] === 'string' ? vars[name] : undefined);
        const plugins = await loadDaemonPlugins({ config, store, apis, resolve, sockets, secret });
        this.#channels = plugins.channels;
        return createApp({ apis, blobApi: createBlobApi(store, createR2BlobStore(env.BLOBS)), web: assetFiles(env.ASSETS), store, plugins, trustActor: true });
      })();
    }

    async fetch(request: Request): Promise<Response> {
      const app = await this.#app;
      const path = new URL(request.url).pathname;
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket' && this.#channels.includes(path)) {
        const pair = new (globalThis as unknown as { WebSocketPair: SocketPair }).WebSocketPair();
        this.#state.acceptWebSocket(pair[1], [path]);
        return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
      }
      return app.fetch(request);
    }

    // Clients only listen, so anything they send is dropped without keeping the object awake.
    webSocketMessage(): void {}
  }

  const toApp = (request: Request, env: SprintsterEnv) => env.APP.get(env.APP.idFromName('app')).fetch(request);

  // Checked here rather than in the Durable Object, so a refused request costs no Durable Object request.
  // The Durable Object trusts the header, so a client's own copy never gets past this point (ADR 20).
  const withActor = (request: Request, actor: string | undefined): Request => {
    if (opts.trustActor === true && actor === undefined) return request;
    const forwarded = new Request(request);
    forwarded.headers.delete(ACTOR_HEADER);
    if (actor !== undefined) forwarded.headers.set(ACTOR_HEADER, actor);
    return forwarded;
  };

  const gate = new Hono<{ Bindings: SprintsterEnv; Variables: { actor: string | undefined } }>()
    .use('*', async (c, next) => {
      if (c.req.path === '/health' || isPublic(c.req.raw)) return next();
      const { SPRINTSTER_USER: username, SPRINTSTER_PASSWORD: password } = c.env;
      if (username === undefined && password === undefined) return next();
      if (!username || !password) {
        return c.json({ code: 'auth_misconfigured', message: 'set both SPRINTSTER_USER and SPRINTSTER_PASSWORD, or neither' }, 500);
      }
      return basicAuth({ username, password, realm: 'sprintster' })(c, async () => {
        c.set('actor', username);
        await next();
      });
    })
    .all('*', (c) => toApp(withActor(c.req.raw, c.get('actor')), c.env));

  const worker = {
    fetch(request: Request, env: SprintsterEnv): Promise<Response> {
      return Promise.resolve(gate.fetch(request, env));
    },
  };

  return { App, worker, isPublic };
}
