import { ApiError } from '../errors/api-error.js';
import { appConfig } from '../config/app-config.js';
import type { ObjectConfig } from '../config/schema.js';
import { objectRoute } from '../config/route.js';
import type { ObjectStatus } from '../plugin/types.js';
import { MAX_PAGE, type ListPage, type ListParams } from '../engine/list-query.js';

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
  // Every record, a page of the largest size at a time (ADR 24).
  list(): Promise<T[]>;
  listAll(params?: Omit<ListParams, 'limit' | 'offset' | 'after'>): Promise<T[]>;
  page(params?: ListParams): Promise<ListPage<T>>;
  get(id: string): Promise<T | null>;
  add(input: unknown): Promise<T>;
  update(id: string, input: unknown): Promise<T>;
  remove(id: string): Promise<T>;
  transition(id: string, command: string): Promise<T>;
  status(): Promise<ObjectStatus | null>;
  sync(): Promise<ObjectStatus>;
  refresh(id: string): Promise<T | null>;
  freeValue(field: string, value: string, ownId?: string): Promise<string>;
}

export interface ApiClient {
  object<T = unknown>(name: string): ObjectClient<T>;
}

export interface CreateApiClientOptions {
  fetch?: typeof fetch;
  objects?: ReadonlyArray<ObjectConfig>;
}

type Call = <T>(opts: { method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; path: string; body?: unknown }) => Promise<T>;

// The singleton is one object at the collection path, so reads ignore the id and there is nothing to create or remove.
function singletonClient<T>(base: string, call: Call): ObjectClient<T> {
  const read = (): Promise<T> => call<T>({ method: 'GET', path: base });
  const unsupported = (action: string): never => {
    throw new Error(`cannot ${action} a singleton object`);
  };
  return {
    list: async () => [await read()],
    listAll: async () => [await read()],
    page: async () => ({ rows: [await read()], total: 1, next: null }),
    get: async () => read(),
    add: () => unsupported('add'),
    update: (_id, input) => call<T>({ method: 'PATCH', path: base, body: input }),
    remove: () => unsupported('remove'),
    transition: () => unsupported('transition'),
    status: async () => null,
    sync: () => unsupported('sync'),
    refresh: async () => read(),
    freeValue: async (_field, value) => value,
  };
}

export function listQuery(params: ListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key === 'filter') for (const f of value as string[]) search.append('filter', f);
    else search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export function createApiClient(
  baseUrl: string,
  options: CreateApiClientOptions = {},
): ApiClient {
  const fetchImpl = options.fetch ?? fetch;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const objects = options.objects ?? appConfig.objects;
  const pathByName = new Map(objects.map((o) => [o.name, `/${objectRoute(o)}`]));
  const singletonNames = new Set(objects.filter((o) => o.singleton === true).map((o) => o.name));

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
    if (singletonNames.has(name)) return singletonClient<T>(base, call);
    const page = (params: ListParams = {}) => call<ListPage<T>>({ method: 'GET', path: `${base}${listQuery(params)}` });
    const listAll = async (params: Omit<ListParams, 'limit' | 'offset' | 'after'> = {}) => {
      const rows: T[] = [];
      let after: string | undefined;
      for (;;) {
        const got = await page({ ...params, limit: MAX_PAGE, ...(after === undefined ? {} : { after }) });
        rows.push(...got.rows);
        if (got.next === null) return rows;
        after = got.next;
      }
    };
    return {
      list: () => listAll(),
      listAll,
      page,
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
      freeValue: async (field, value, ownId) => {
        const query = new URLSearchParams({ field, value, ...(ownId === undefined ? {} : { id: ownId }) });
        return (await call<{ value: string }>({ method: 'GET', path: `${base}/_free?${query}` })).value;
      },
    };
  }

  return { object };
}
