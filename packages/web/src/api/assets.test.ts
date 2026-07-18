import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadAsset, assetUrl } from './assets.js';

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
