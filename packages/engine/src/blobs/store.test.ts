import { describe, it, expect } from 'vitest';
import { InMemoryBlobStore, sha256Hex } from './store.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('computes the known sha256 hex of "hello"', async () => {
    expect(await sha256Hex(enc('hello'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

describe('InMemoryBlobStore', () => {
  it('putBlob is content-addressed and idempotent for identical bytes', async () => {
    const store = new InMemoryBlobStore();
    const a = await store.putBlob(enc('hello'), 'text/plain');
    const b = await store.putBlob(enc('hello'), 'text/plain');
    expect(a.hash).toBe(b.hash);
    expect(a.size).toBe(5);
  });

  it('different bytes yield different hashes', async () => {
    const store = new InMemoryBlobStore();
    expect((await store.putBlob(enc('a'))).hash).not.toBe((await store.putBlob(enc('b'))).hash);
  });

  it('getBlob returns the bytes and content type', async () => {
    const store = new InMemoryBlobStore();
    const { hash } = await store.putBlob(enc('hello'), 'image/png');
    const got = await store.getBlob(hash);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello');
    expect(got!.contentType).toBe('image/png');
  });

  it('getBlob returns null for an unknown hash', async () => {
    expect(await new InMemoryBlobStore().getBlob('deadbeef')).toBeNull();
  });

  it('hasBlob reflects presence', async () => {
    const store = new InMemoryBlobStore();
    const { hash } = await store.putBlob(enc('x'));
    expect(await store.hasBlob(hash)).toBe(true);
    expect(await store.hasBlob('nope')).toBe(false);
  });

  it('keeps the first content type on an idempotent re-put', async () => {
    const store = new InMemoryBlobStore();
    const { hash } = await store.putBlob(enc('hello'), 'image/png');
    await store.putBlob(enc('hello'), 'text/plain');
    expect((await store.getBlob(hash))!.contentType).toBe('image/png');
  });

  it('defaults an omitted content type to null', async () => {
    const store = new InMemoryBlobStore();
    const { hash } = await store.putBlob(enc('x'));
    expect((await store.getBlob(hash))!.contentType).toBeNull();
  });
});
