import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../errors/api-error.js';
import { createApiClient, NetworkError, isNetworkError } from './client.js';
import { fixtureConfig } from '../config/fixture.js';
import { setAppConfig } from '../config/app-config.js';

setAppConfig(fixtureConfig);

const BASE = 'http://127.0.0.1:3030';

const ID_A = '11111111-1111-4111-8111-111111111111';

const sampleClient = {
  id: ID_A,
  name: 'Alfie Granger-Howell',
  service: 'student',
  rate: '5000',
  paymentTermsDays: 7,
  address: null,
  notes: null,
  removed: false,
};

const validInput = {
  id: ID_A,
  name: 'Alfie Granger-Howell',
  service: 'student',
  rate: '5000',
  paymentTermsDays: 7,
  address: null,
  notes: null,
};

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(handlers: Array<{
  match: { method: string; path: string };
  response: { status: number; body: unknown };
}>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body !== undefined && init.body !== null) {
      body = JSON.parse(String(init.body)) as unknown;
    }
    calls.push({ url, method, body });
    const path = url.replace(BASE, '');
    const handler = handlers.find((h) => h.match.method === method && h.match.path === path);
    if (handler === undefined) {
      throw new Error(`unexpected ${method} ${path}`);
    }
    return new Response(JSON.stringify(handler.response.body), {
      status: handler.response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fakeFetch, calls };
}

describe('createApiClient.clients.list', () => {
  it('returns parsed clients array', async () => {
    const { fetch } = mockFetch([
      { match: { method: 'GET', path: '/clients' }, response: { status: 200, body: [sampleClient] } },
    ]);
    const api = createApiClient(BASE, { fetch });
    const result = await api.object('client').list();
    expect(result).toEqual([sampleClient]);
  });

  it('handles an empty list', async () => {
    const { fetch } = mockFetch([
      { match: { method: 'GET', path: '/clients' }, response: { status: 200, body: [] } },
    ]);
    const api = createApiClient(BASE, { fetch });
    expect(await api.object('client').list()).toEqual([]);
  });
});

describe('createApiClient.clients.get', () => {
  it('returns the client on 200', async () => {
    const { fetch } = mockFetch([
      { match: { method: 'GET', path: '/clients/GRA-A26' }, response: { status: 200, body: sampleClient } },
    ]);
    const api = createApiClient(BASE, { fetch });
    expect(await api.object('client').get('GRA-A26')).toEqual(sampleClient);
  });

  it('returns null on 404', async () => {
    const { fetch } = mockFetch([
      {
        match: { method: 'GET', path: '/clients/XXX-Z99' },
        response: { status: 404, body: { code: 'not_found', message: 'client not found' } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    expect(await api.object('client').get('XXX-Z99')).toBeNull();
  });

  it('URL-encodes the id', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: { method: 'GET', path: '/clients/weird%2Fid' },
        response: { status: 200, body: sampleClient },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    await api.object('client').get('weird/id');
    expect(calls[0]?.url).toContain('weird%2Fid');
  });
});

describe('createApiClient.clients.add', () => {
  it('POSTs to /clients with the input body', async () => {
    const { fetch, calls } = mockFetch([
      { match: { method: 'POST', path: '/clients' }, response: { status: 201, body: sampleClient } },
    ]);
    const api = createApiClient(BASE, { fetch });
    const result = await api.object('client').add(validInput);
    expect(result).toEqual(sampleClient);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual(validInput);
  });

  it('throws ApiError on 409 already_exists', async () => {
    const { fetch } = mockFetch([
      {
        match: { method: 'POST', path: '/clients' },
        response: { status: 409, body: { code: 'already_exists', message: 'taken' } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    try {
      await api.object('client').add(validInput);
      throw new Error('expected ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('already_exists');
    }
  });

  it('throws ApiError on 400 validation errors', async () => {
    const { fetch } = mockFetch([
      {
        match: { method: 'POST', path: '/clients' },
        response: { status: 400, body: { code: 'bad_request', message: 'invalid' } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    await expect(api.object('client').add(validInput)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createApiClient.clients.update', () => {
  it('PATCHes /clients/:id with the patch body and returns the updated client', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: { method: 'PATCH', path: '/clients/GRA-A26' },
        response: { status: 200, body: { ...sampleClient, name: 'Alfie', rate: '6000' } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    const result = await api.object('client').update('GRA-A26', { name: 'Alfie', rate: '6000' });
    expect(result.name).toBe('Alfie');
    expect(result.rate).toBe('6000');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ name: 'Alfie', rate: '6000' });
  });

  it('throws ApiError on 404 for an unknown id', async () => {
    const { fetch } = mockFetch([
      {
        match: { method: 'PATCH', path: '/clients/XXX-Z99' },
        response: { status: 404, body: { code: 'not_found', message: 'client not found' } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    await expect(api.object('client').update('XXX-Z99', { name: 'Nobody' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createApiClient.clients.remove', () => {
  it('remove DELETEs /clients/:id', async () => {
    const { fetch, calls } = mockFetch([
      {
        match: { method: 'DELETE', path: '/clients/GRA-A26' },
        response: { status: 200, body: { ...sampleClient, removed: true } },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    const result = await api.object('client').remove('GRA-A26');
    expect(result.removed).toBe(true);
    expect(calls[0]?.method).toBe('DELETE');
  });
});

describe('createApiClient error handling', () => {
  it('throws NetworkError when fetch itself rejects', async () => {
    const failingFetch = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const api = createApiClient(BASE, { fetch: failingFetch });
    try {
      await api.object('client').list();
      throw new Error('expected NetworkError');
    } catch (err) {
      expect(isNetworkError(err)).toBe(true);
      expect(err).toBeInstanceOf(NetworkError);
    }
  });

  it('throws ApiError with http_error code when body has no code', async () => {
    const { fetch } = mockFetch([
      {
        match: { method: 'GET', path: '/clients' },
        response: { status: 500, body: 'oops not json shape' },
      },
    ]);
    const api = createApiClient(BASE, { fetch });
    try {
      await api.object('client').list();
      throw new Error('expected ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const e = err as ApiError;
      expect(e.statusCode).toBe(500);
      expect(e.code).toBe('http_error');
    }
  });

  it('trims trailing slashes from baseUrl', async () => {
    const { fetch, calls } = mockFetch([
      { match: { method: 'GET', path: '/clients' }, response: { status: 200, body: [] } },
    ]);
    const api = createApiClient(`${BASE}//`, { fetch });
    await api.object('client').list();
    expect(calls[0]?.url).toBe(`${BASE}/clients`);
  });
});
