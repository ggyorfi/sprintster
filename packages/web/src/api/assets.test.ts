import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadConfig, setAppConfig } from '@sprintster/engine';
import { uploadAsset, assetUrl, storedAssetUrl, attachAsset } from './assets.js';

const uploaded = { hash: 'd4', filename: 'hero.png', contentType: 'image/png', size: 30 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadAsset', () => {
  it('POSTs the file as multipart and returns the parsed asset', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(uploaded), { status: 201 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
    const result = await uploadAsset(file);
    expect(result).toEqual(uploaded);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/assets');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBeInstanceOf(FormData);
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    await expect(uploadAsset(file)).rejects.toThrow(/upload failed/);
  });
});

describe('assetUrl', () => {
  it('builds the /assets/:hash path', () => {
    expect(assetUrl('d4')).toBe('/assets/d4');
  });
});

describe('storedAssetUrl', () => {
  it('strips a full origin, so a body authored against a remote daemon is not tied to it', () => {
    const env = { VITE_API_URL: 'https://app.example.com' };
    expect(storedAssetUrl('https://app.example.com/assets/d4', env)).toBe('/assets/d4');
  });

  it('strips a proxied path prefix', () => {
    expect(storedAssetUrl('/api/assets/d4', { VITE_API_URL: '/api' })).toBe('/assets/d4');
  });

  it('leaves an already root-relative reference alone', () => {
    expect(storedAssetUrl('/assets/d4', {})).toBe('/assets/d4');
    expect(storedAssetUrl('/assets/d4', { VITE_API_URL: '/api' })).toBe('/assets/d4');
  });

  it('is the exact inverse of assetUrl', () => {
    expect(storedAssetUrl(assetUrl('d4'))).toBe('/assets/d4');
  });

  it('passes through a URL that is not ours: it is content, not an asset reference', () => {
    const env = { VITE_API_URL: 'https://app.example.com' };
    expect(storedAssetUrl('https://elsewhere.example/photo.png', env)).toBe('https://elsewhere.example/photo.png');
    expect(storedAssetUrl('data:image/png;base64,iVBOR', env)).toBe('data:image/png;base64,iVBOR');
    expect(storedAssetUrl('https://app.example.com/other/d4', env)).toBe('https://app.example.com/other/d4');
  });
});

describe('attachAsset', () => {
  const withAssets = () =>
    setAppConfig(
      loadConfig({
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
      }),
    );

  afterEach(() => setAppConfig(loadConfig({ version: '1', objects: [] })));

  const file = () => new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });

  it('uploads the bytes, then creates the asset record holding them', async () => {
    withAssets();
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/assets')) return new Response(JSON.stringify(uploaded), { status: 201 });
        return new Response(JSON.stringify({ id: 'x' }), { status: 201 });
      }),
    );

    const { id } = await attachAsset(file());
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(calls[0]!.url).toContain('/assets');
    expect(calls[1]!.url).toContain('/media');
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ id, file: uploaded });
  });

  it('refuses when the config names no assets object, rather than writing a dangling URL', async () => {
    setAppConfig(loadConfig({ version: '1', objects: [] }));
    await expect(attachAsset(file())).rejects.toThrow(/no assets object/);
  });

  it('surfaces the server message when the record cannot be created', async () => {
    withAssets();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/assets')
          ? new Response(JSON.stringify(uploaded), { status: 201 })
          : new Response(JSON.stringify({ code: 'bad_request', message: 'title is required' }), { status: 400 }),
      ),
    );
    await expect(attachAsset(file())).rejects.toThrow(/title is required/);
  });
});
