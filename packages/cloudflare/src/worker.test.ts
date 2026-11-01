import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import worker from '../test/worker.js';
import type { SprintsterEnv } from './index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const req = (path: string, init?: RequestInit) => SELF.fetch(`https://app.test${path}`, init);

describe('createWorker', () => {
  it('answers the API from the Durable Object', async () => {
    const res = await req('/health');
    expect(res.status).toBe(200);
    expect(((await (await req('/config')).json()) as { objects: unknown[] }).objects).toHaveLength(1);
  });

  it('writes and reads records through the event log', async () => {
    const created = await req('/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID, title: 'First' }),
    });
    expect(created.status).toBe(201);
    await req(`/notes/${ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Edited' }),
    });
    expect(await (await req(`/notes/${ID}`)).json()).toMatchObject({ id: ID, title: 'Edited' });
    expect(await (await req('/notes')).json()).toEqual([expect.objectContaining({ id: ID, title: 'Edited' })]);
  });

  it('stores uploads in R2 and serves them back by hash', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const form = new FormData();
    form.append('file', new File([png], 'pixel.png', { type: 'image/png' }));
    const up = await req('/assets', { method: 'POST', body: form });
    expect(up.status).toBe(201);
    const { hash } = (await up.json()) as { hash: string };
    const got = await req(`/assets/${hash}`);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
  });

  it('serves the web GUI, falling back to index.html for client routes', async () => {
    expect(await (await req('/')).text()).toContain('id="root"');
    expect(await (await req('/_app/app.js')).text()).toContain('bundle');
    expect(await (await req('/some/client/route')).text()).toContain('id="root"');
    expect((await req('/_app/missing.js')).status).toBe(404);
  });

  it('answers an unknown API path as JSON, not with the GUI', async () => {
    const res = await req(`/notes/${ID}/extra`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('basic auth', () => {
  const auth = (user: string, password: string) => ({ authorization: `Basic ${btoa(`${user}:${password}`)}` });
  const call = (path: string, vars: Partial<SprintsterEnv>, headers?: HeadersInit) =>
    worker.fetch(new Request(`https://app.test${path}`, headers === undefined ? {} : { headers }), { ...(env as unknown as SprintsterEnv), ...vars });
  const secrets = { SPRINTSTER_USER: 'gabor', SPRINTSTER_PASSWORD: 's3cret' };

  it('asks for credentials when both secrets are set', async () => {
    const res = await call('/notes', secrets);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="sprintster"');
    expect((await call('/', secrets)).status).toBe(401);
  });

  it('lets the right credentials through and refuses wrong ones', async () => {
    expect((await call('/notes', secrets, auth('gabor', 's3cret'))).status).toBe(200);
    expect((await call('/notes', secrets, auth('gabor', 'wrong'))).status).toBe(401);
  });

  it('keeps /health open', async () => {
    expect((await call('/health', secrets)).status).toBe(200);
  });

  it('refuses every request when only one secret is set', async () => {
    const res = await call('/notes', { SPRINTSTER_USER: 'gabor' }, auth('gabor', ''));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'auth_misconfigured' });
  });
});
