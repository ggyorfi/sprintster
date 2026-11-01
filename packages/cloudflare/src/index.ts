import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { buildApis, createApp, type StaticFiles } from '@sprintster/daemon';
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

export interface SprintsterWorker {
  // The Durable Object class; the project's Worker module exports it under the name its wrangler config binds as APP.
  App: new (state: { storage: DurableObjectSqlStorage }, env: SprintsterEnv) => Fetcher;
  worker: { fetch(request: Request, env: SprintsterEnv): Promise<Response> };
}

// One app per Worker: every request goes to the same Durable Object, whose SQLite storage holds the event log.
export function createWorker(projectConfig: { app: unknown }): SprintsterWorker {
  const config = loadConfig(projectConfig.app);

  class App {
    readonly #app;

    constructor(state: { storage: DurableObjectSqlStorage }, env: SprintsterEnv) {
      setAppConfig(config);
      const store = createDurableObjectEventStore(state.storage);
      this.#app = createApp({
        apis: buildApis(config, store),
        blobApi: createBlobApi(store, createR2BlobStore(env.BLOBS)),
        web: assetFiles(env.ASSETS),
      });
    }

    fetch(request: Request): Promise<Response> {
      return Promise.resolve(this.#app.fetch(request));
    }
  }

  const toApp = (request: Request, env: SprintsterEnv) => env.APP.get(env.APP.idFromName('app')).fetch(request);

  // Checked here rather than in the Durable Object, so a refused request costs no Durable Object request.
  const gate = new Hono<{ Bindings: SprintsterEnv }>()
    .use('*', async (c, next) => {
      if (c.req.path === '/health') return next();
      const { SPRINTSTER_USER: username, SPRINTSTER_PASSWORD: password } = c.env;
      if (username === undefined && password === undefined) return next();
      if (!username || !password) {
        return c.json({ code: 'auth_misconfigured', message: 'set both SPRINTSTER_USER and SPRINTSTER_PASSWORD, or neither' }, 500);
      }
      return basicAuth({ username, password, realm: 'sprintster' })(c, next);
    })
    .all('*', (c) => toApp(c.req.raw, c.env));

  const worker = {
    fetch(request: Request, env: SprintsterEnv): Promise<Response> {
      return Promise.resolve(gate.fetch(request, env));
    },
  };

  return { App, worker };
}
