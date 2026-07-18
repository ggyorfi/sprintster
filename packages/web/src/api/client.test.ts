import { describe, it, expect, vi } from 'vitest';
import { createWebApiClient } from './client.js';
import { setAppConfig, fixtureRefConfig } from '@sprintster/engine';

setAppConfig(fixtureRefConfig);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createWebApiClient', () => {
  it('routes object calls through the configured base url and config-derived path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const api = createWebApiClient({ baseUrl: '/api', fetch: fetchMock as unknown as typeof fetch });

    await api.object('client').list();

    expect(fetchMock).toHaveBeenCalledWith('/api/clients', expect.objectContaining({ method: 'GET' }));
  });

  it('targets a remote base url unchanged for a cloud deploy', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const api = createWebApiClient({
      baseUrl: 'https://app.example.com',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await api.object('memo').list();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/memos',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
