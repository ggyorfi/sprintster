import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlobApi, InMemoryBlobStore, InMemoryEventStore } from '@sprintster/engine';
import { createApp } from '../app.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function buildApp() {
  const events = new InMemoryEventStore();
  const blobs = new InMemoryBlobStore();
  const app = createApp({ apis: [], blobApi: createBlobApi(events, blobs) });
  return { events, app };
}

function upload(bytes: Uint8Array, contentType: string, filename = 'hero.png'): RequestInit {
  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart], { type: contentType }), filename);
  return { method: 'POST', body: form };
}

async function hashOf(res: Response): Promise<string> {
  return ((await res.json()) as { hash: string }).hash;
}

describe('POST /assets', () => {
  it('uploads bytes, returns 201 with hash/size/contentType/filename, and records a BlobUploaded fact', async () => {
    const { app, events } = buildApp();
    const res = await app.request('/assets', upload(png, 'image/png'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { hash: string; size: number; contentType: string; filename: string };
    expect(body.size).toBe(png.byteLength);
    expect(body.contentType).toBe('image/png');
    expect(body.filename).toBe('hero.png');
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    const rows = await events.findByStream(0, '__blob', body.hash);
    expect(rows[0]?.eventType).toBe('BlobUploaded');
  });

  it('is idempotent: re-uploading identical bytes returns the same hash', async () => {
    const { app } = buildApp();
    const a = await hashOf(await app.request('/assets', upload(png, 'image/png')));
    const b = await hashOf(await app.request('/assets', upload(png, 'image/png')));
    expect(a).toBe(b);
  });

  it('rejects an empty upload with 400', async () => {
    const { app } = buildApp();
    expect((await app.request('/assets', upload(new Uint8Array(0), 'image/png'))).status).toBe(400);
  });

  it('rejects a request without a "file" field with 400', async () => {
    const { app } = buildApp();
    const form = new FormData();
    form.append('notfile', 'oops');
    expect((await app.request('/assets', { method: 'POST', body: form })).status).toBe(400);
  });
});

describe('GET /assets/:hash', () => {
  it('serves the stored bytes with content type and an immutable cache header', async () => {
    const { app } = buildApp();
    const hash = await hashOf(await app.request('/assets', upload(png, 'image/png')));
    const res = await app.request(`/assets/${hash}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(png));
  });

  it('returns 404 for an unknown hash', async () => {
    const { app } = buildApp();
    expect((await app.request('/assets/deadbeef')).status).toBe(404);
  });
});

describe('/assets is not mounted without a blob api, nor shadowed by the web catch-all', () => {
  it('is absent (404) when no blobApi is provided', async () => {
    const app = createApp({ apis: [] });
    expect((await app.request('/assets', upload(png, 'image/png'))).status).toBe(404);
  });

  it('still serves POST /assets with a webRoot mounted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprintster-assets-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    const events = new InMemoryEventStore();
    const app = createApp({ apis: [], blobApi: createBlobApi(events, new InMemoryBlobStore()), webRoot: dir });
    expect((await app.request('/assets', upload(png, 'image/png'))).status).toBe(201);
  });
});
