import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadAsset, assetUrl, storedAssetUrl } from './assets.js';

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
