import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import worker, { isPublic } from '../test/worker.js';
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
    expect(((await (await req('/notes')).json()) as { rows: unknown[] }).rows).toEqual([expect.objectContaining({ id: ID, title: 'Edited' })]);
  });

  it('drops a client\'s claim to be someone when nothing authenticates', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await req('/notes', { method: 'POST', headers: { 'content-type': 'application/json', 'Sprintster-Actor': 'mallory' }, body: JSON.stringify({ id, title: 'Anon' }) });
    const log = (await (await req('/log')).json()) as { changes: Array<{ id: string; actor: string }> };
    expect(log.changes.find((c) => c.id === id)?.actor).toBe('system');
  });

  it('pages, sorts and searches inside the Durable Object (ADR 24)', async () => {
    const titles = ['Óra', 'alma', 'Zebra'];
    for (const [i, title] of titles.entries()) {
      await req('/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: `5555555${i}-5555-4555-8555-555555555555`, title }) });
    }
    const page = (await (await req('/notes?limit=2&sort=title&q=a')).json()) as { rows: Array<{ title: string }>; total: number; next: string | null };
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.rows).toHaveLength(2);
    expect(page.next).not.toBeNull();
    expect(((await (await req('/notes?q=ora')).json()) as { rows: Array<{ title: string }> }).rows.map((r) => r.title)).toContain('Óra');
    expect((await req('/notes?limit=101')).status).toBe(400);
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

  it('records the authenticated user as the actor and ignores a client\'s own claim', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const headers = { ...auth('gabor', 's3cret'), 'content-type': 'application/json', 'Sprintster-Actor': 'mallory' };
    const env2 = { ...(env as unknown as SprintsterEnv), ...secrets };
    await worker.fetch(new Request('https://app.test/notes', { method: 'POST', headers, body: JSON.stringify({ id, title: 'Mine' }) }), env2);
    const log = (await (await call('/log', secrets, auth('gabor', 's3cret'))).json()) as { changes: Array<{ id: string; actor: string }> };
    expect(log.changes.find((c) => c.id === id)?.actor).toBe('gabor');
  });

  it('keeps /health open', async () => {
    expect((await call('/health', secrets)).status).toBe(200);
  });

  it('lets a declared public plugin route through and keeps the plugin\'s other routes gated', async () => {
    expect((await call('/plugins/ping/open', secrets)).status).toBe(200);
    expect((await call('/plugins/ping/pong', secrets)).status).toBe(401);
    expect((await worker.fetch(new Request('https://app.test/plugins/ping/open', { method: 'POST' }), { ...(env as unknown as SprintsterEnv), ...secrets })).status).toBe(401);
  });

  it('refuses every request when only one secret is set', async () => {
    const res = await call('/notes', { SPRINTSTER_USER: 'gabor' }, auth('gabor', ''));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'auth_misconfigured' });
  });
});

describe('plugins', () => {
  it('serves a plugin route and lists its badge in /config', async () => {
    expect(await (await req('/plugins/ping/pong')).json()).toMatchObject({ position: expect.any(Number) });
    const config = (await (await req('/config')).json()) as { extensions: { badges: Array<{ route: string }> } };
    expect(config.extensions.badges).toEqual([{ id: 'ping.pong', route: '/plugins/ping/pong' }]);
  });

  it('pushes channel messages to a connected socket', async () => {
    const res = await req('/plugins/ping/channels/news', { headers: { upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = (res as unknown as { webSocket: WebSocket & { accept(): void } }).webSocket;
    ws.accept();
    const received = new Promise<string>((resolve) => ws.addEventListener('message', (e) => resolve(String(e.data))));
    await req('/plugins/ping/say', { method: 'POST' });
    expect(JSON.parse(await received)).toEqual({ type: 'hello' });
    ws.close();
  });

  it('hands a plugin the secret it declares from the Worker env', async () => {
    expect(await (await req('/plugins/ping/open')).json()).toEqual({ secretLength: 'pong-secret'.length });
  });

  it('returns isPublic for a gate wrapping the worker', () => {
    expect(isPublic(new Request('https://app.test/plugins/ping/open'))).toBe(true);
    expect(isPublic(new Request('https://app.test/plugins/ping/pong'))).toBe(false);
  });

  it('does not upgrade a path that is not a channel', async () => {
    expect((await req('/plugins/ping/channels/other', { headers: { upgrade: 'websocket' } })).status).not.toBe(101);
  });

  it('refuses to start when the config names a plugin it was not given', async () => {
    const { createWorker } = await import('./index.js');
    expect(() => createWorker({ app: { version: '1', objects: [], plugins: [{ name: 'plugin-missing' }] } })).toThrow(/plugin-missing/);
  });
});
