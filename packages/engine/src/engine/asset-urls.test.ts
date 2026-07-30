import { describe, it, expect } from 'vitest';
import { assetIdsByHash, rewriteAssetUrls } from './asset-urls.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const row = (id: string, hash: string) => ({ id, file: { hash, filename: 'x.png' } });

describe('assetIdsByHash', () => {
  it('indexes each asset by the blob it holds', () => {
    const index = assetIdsByHash([row('one', HASH_A), row('two', HASH_B)], 'file');
    expect(index.get(HASH_A)).toBe('one');
    expect(index.get(HASH_B)).toBe('two');
  });

  it('marks a blob held by two assets as ambiguous rather than picking one', () => {
    const index = assetIdsByHash([row('one', HASH_A), row('two', HASH_A)], 'file');
    expect(index.get(HASH_A)).toBeNull();
  });

  it('ignores rows with no file', () => {
    const index = assetIdsByHash([{ id: 'one', file: null }, { id: 'two' }], 'file');
    expect(index.size).toBe(0);
  });
});

describe('rewriteAssetUrls', () => {
  const index = new Map<string, string | null>([[HASH_A, 'asset-1']]);

  it('rewrites a hash URL to the asset that holds it', () => {
    const { body, skipped } = rewriteAssetUrls(`Intro\n\n![A cover](/assets/${HASH_A})\n\nOutro`, index);
    expect(body).toBe('Intro\n\n![A cover](/assets/asset-1)\n\nOutro');
    expect(skipped).toEqual([]);
  });

  it('rewrites every occurrence, including the same image twice', () => {
    const { body } = rewriteAssetUrls(`![](/assets/${HASH_A}) and again ![](/assets/${HASH_A})`, index);
    expect(body.match(/\/assets\/asset-1/g)).toHaveLength(2);
  });

  it('leaves a hash no asset holds alone, and reports it once', () => {
    const { body, skipped } = rewriteAssetUrls(`![](/assets/${HASH_B}) ![](/assets/${HASH_B})`, index);
    expect(body).toContain(`/assets/${HASH_B}`);
    expect(skipped).toEqual([{ hash: HASH_B, reason: 'unknown' }]);
  });

  it('leaves an ambiguous hash alone rather than guessing which asset was meant', () => {
    const ambiguous = new Map<string, string | null>([[HASH_A, null]]);
    const { body, skipped } = rewriteAssetUrls(`![](/assets/${HASH_A})`, ambiguous);
    expect(body).toBe(`![](/assets/${HASH_A})`);
    expect(skipped).toEqual([{ hash: HASH_A, reason: 'ambiguous' }]);
  });

  it('is idempotent: a rewritten body has nothing left to match', () => {
    const once = rewriteAssetUrls(`![](/assets/${HASH_A})`, index);
    const twice = rewriteAssetUrls(once.body, index);
    expect(twice.body).toBe(once.body);
    expect(twice.skipped).toEqual([]);
  });

  it('leaves URLs that are not asset hashes untouched', () => {
    const body = '![](/assets/not-a-hash) ![](https://elsewhere.example/p.png) ![](data:image/png;base64,iVBOR)';
    expect(rewriteAssetUrls(body, index).body).toBe(body);
  });
});
