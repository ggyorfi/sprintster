import { ApiError } from '../errors/api-error.js';
import { appConfig } from '../config/app-config.js';
import type { ObjectConfig } from '../config/schema.js';
import type { ObjectStatus } from '../plugin/types.js';

export class NetworkError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isNetworkError(value: unknown): value is NetworkError {
  return value instanceof NetworkError;
}

export interface ObjectClient<T> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  add(input: unknown): Promise<T>;
  update(id: string, input: unknown): Promise<T>;
  remove(id: string): Promise<T>;
  transition(id: string, command: string): Promise<T>;
  status(): Promise<ObjectStatus | null>;
  sync(): Promise<ObjectStatus>;
  refresh(id: string): Promise<T | null>;
}

export interface ApiClient {
  object<T = unknown>(name: string): ObjectClient<T>;
}

export interface CreateApiClientOptions {
  fetch?: typeof fetch;
  objects?: ReadonlyArray<ObjectConfig>;
}

export function createApiClient(
  baseUrl: string,
  options: CreateApiClientOptions = {},
): ApiClient {
  const fetchImpl = options.fetch ?? fetch;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const objects = options.objects ?? appConfig.objects;
  const pathByName = new Map(objects.map((o) => [o.name, `/${o.titlePlural.toLowerCase()}`]));

  async function call<T>(opts: {
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
    path: string;
    body?: unknown;
  }): Promise<T> {
    const url = `${trimmedBase}${opts.path}`;
    const init: RequestInit = { method: opts.method };
    if (opts.body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(`cannot reach ${opts.method} ${url}`, err);
    }

    if (!res.ok) {
      let errBody: { code?: string; message?: string } = {};
      try {
        const parsed = (await res.json()) as unknown;
        if (parsed !== null && typeof parsed === 'object') {
          errBody = parsed as { code?: string; message?: string };
        }
      } catch {
        errBody = {};
      }
      throw new ApiError(
        errBody.code ?? 'http_error',
        errBody.message ?? res.statusText,
        res.status,
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new NetworkError(`invalid JSON from ${opts.method} ${url}`, err);
    }
    return json as T;
  }

  function object<T = unknown>(name: string): ObjectClient<T> {
    const base = pathByName.get(name);
    if (base === undefined) throw new Error(`unknown object '${name}'`);
    const idPath = (id: string): string => `${base}/${encodeURIComponent(id)}`;
    return {
      list: () => call<T[]>({ method: 'GET', path: base }),
      get: async (id) => {
        try {
          return await call<T>({ method: 'GET', path: idPath(id) });
        } catch (err) {
          if (err instanceof ApiError && err.statusCode === 404) return null;
          throw err;
        }
      },
      add: (input) => call<T>({ method: 'POST', path: base, body: input }),
      update: (id, input) => call<T>({ method: 'PATCH', path: idPath(id), body: input }),
      remove: (id) => call<T>({ method: 'DELETE', path: idPath(id) }),
      transition: (id, command) => call<T>({ method: 'PATCH', path: idPath(id), body: { _command: command } }),
      status: async () => {
        try {
          return await call<ObjectStatus>({ method: 'GET', path: `${base}/_status` });
        } catch (err) {
          if (err instanceof ApiError && err.statusCode === 404) return null;
          throw err;
        }
      },
      sync: () => call<ObjectStatus>({ method: 'POST', path: `${base}/_sync` }),
      refresh: async (id) => {
        try {
          return await call<T>({ method: 'POST', path: `${idPath(id)}/_refresh` });
        } catch (err) {
          if (err instanceof ApiError && err.statusCode === 404) return null;
          throw err;
        }
      },
    };
  }

  return { object };
}
