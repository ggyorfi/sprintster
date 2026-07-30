import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBlobApi,
  createObjectApi,
  InMemoryBlobStore,
  InMemoryEventStore,
  loadConfig,
  setAppConfig,
  type ObjectConfig,
} from '@sprintster/engine';
import { createApp } from '../app.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 1, 2, 3, 4]);

const ASSET_A = '11111111-1111-4111-8111-111111111111';

function assetConfig() {
  return loadConfig({
    version: '1',
    assets: 'asset',
    objects: [
      {
        name: 'asset',
        title: 'Asset',
        titlePlural: 'Assets',
        route: 'media',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'file', type: 'image', title: 'File' },
          { name: 'removed', type: 'boolean', system: true },
        ],
        lists: [{ name: 'default', title: 'Assets', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
      },
    ],
  });
}

function build(opts: { assets?: boolean; webRoot?: string } = {}) {
  const config = assetConfig();
  setAppConfig(opts.assets === false ? loadConfig({ version: '1', objects: [] }) : config);
  const events = new InMemoryEventStore();
  const obj = config.objects[0] as ObjectConfig;
  const api = createObjectApi<{ id: string }>(events, obj);
  const blobApi = createBlobApi(events, new InMemoryBlobStore());
  const app = createApp({
    apis: [{ obj, api }],
    blobApi,
    ...(opts.webRoot !== undefined ? { webRoot: opts.webRoot } : {}),
  });
  return { app, api, blobApi };
}

async function upload(blobApi: Awaited<ReturnType<typeof build>>['blobApi'], bytes: Uint8Array, type: string) {
  return (await blobApi.upload(bytes, type)).hash;
}

const fileValue = (hash: string, contentType: string) => ({
  hash,
  filename: 'hero.png',
  contentType,
  size: 11,
});

afterEach(() => {
  setAppConfig(loadConfig({ version: '1', objects: [] }));
});

describe('GET /assets/:id', () => {
  it('serves the blob the asset currently holds', async () => {
    const { app, api, blobApi } = build();
    const hash = await upload(blobApi, png, 'image/png');
    await api.add!({ id: ASSET_A, file: fileValue(hash, 'image/png') });

    const res = await app.request(`/assets/${ASSET_A}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(png));
  });

  it('follows a replacement, which is the whole reason for the id URL', async () => {
    const { app, api, blobApi } = build();
    const first = await upload(blobApi, png, 'image/png');
    const second = await upload(blobApi, gif, 'image/gif');
    await api.add!({ id: ASSET_A, file: fileValue(first, 'image/png') });

    await api.update!(ASSET_A, { file: fileValue(second, 'image/gif') });

    const res = await app.request(`/assets/${ASSET_A}`);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(gif));
  });

  it('is revalidated rather than immutable, and carries the hash as its ETag', async () => {
    const { app, api, blobApi } = build();
    const hash = await upload(blobApi, png, 'image/png');
    await api.add!({ id: ASSET_A, file: fileValue(hash, 'image/png') });

    const res = await app.request(`/assets/${ASSET_A}`);
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    expect(res.headers.get('cache-control')).not.toContain('immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers 304 to a matching If-None-Match, and 200 once the file has changed', async () => {
    const { app, api, blobApi } = build();
    const first = await upload(blobApi, png, 'image/png');
    await api.add!({ id: ASSET_A, file: fileValue(first, 'image/png') });
    const etag = (await app.request(`/assets/${ASSET_A}`)).headers.get('etag')!;

    const fresh = await app.request(`/assets/${ASSET_A}`, { headers: { 'if-none-match': etag } });
    expect(fresh.status).toBe(304);
    expect((await fresh.arrayBuffer()).byteLength).toBe(0);

    const second = await upload(blobApi, gif, 'image/gif');
    await api.update!(ASSET_A, { file: fileValue(second, 'image/gif') });
    const changed = await app.request(`/assets/${ASSET_A}`, { headers: { 'if-none-match': etag } });
    expect(changed.status).toBe(200);
  });

  it('answers HEAD with the ETag and no body, so a build can read the hash cheaply', async () => {
    const { app, api, blobApi } = build();
    const hash = await upload(blobApi, png, 'image/png');
    await api.add!({ id: ASSET_A, file: fileValue(hash, 'image/png') });

    const res = await app.request(`/assets/${ASSET_A}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('404s an unknown id and a removed asset', async () => {
    const { app, api, blobApi } = build();
    const hash = await upload(blobApi, png, 'image/png');
    await api.add!({ id: ASSET_A, file: fileValue(hash, 'image/png') });

    expect((await app.request('/assets/22222222-2222-4222-8222-222222222222')).status).toBe(404);
    await api.remove!(ASSET_A);
    expect((await app.request(`/assets/${ASSET_A}`)).status).toBe(404);
  });

  it('404s when the config names no assets object', async () => {
    const { app } = build({ assets: false });
    expect((await app.request(`/assets/${ASSET_A}`)).status).toBe(404);
  });

  it('still lets a static file under /assets fall through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprintster-assets-id-'));
    writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'logo.png'), 'not really a png');
    const { app } = build({ webRoot: dir });
    const res = await app.request('/assets/logo.png');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('not really');
  });

  it('publishes the assets name on /config, so the web knows where to create records', async () => {
    const { app } = build();
    const body = (await (await app.request('/config')).json()) as { assets?: string };
    expect(body.assets).toBe('asset');

    const { app: bare } = build({ assets: false });
    const bareBody = (await (await bare.request('/config')).json()) as { assets?: string };
    expect(bareBody.assets).toBeUndefined();
  });
});
