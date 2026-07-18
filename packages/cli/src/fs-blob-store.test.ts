import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsBlobStore } from './fs-blob-store.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sprintster-blob-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createFsBlobStore', () => {
  it('putBlob writes a content-addressed file and returns the hash and size', async () => {
    const store = createFsBlobStore(freshDir());
    const ref = await store.putBlob(enc('hello'), 'image/png');
    expect(ref.hash).toBe(HELLO_SHA);
    expect(ref.size).toBe(5);
    expect(await store.hasBlob(ref.hash)).toBe(true);
  });

  it('shards the file by hash prefix', async () => {
    const dir = freshDir();
    const { hash } = await createFsBlobStore(dir).putBlob(enc('hello'));
    expect(existsSync(join(dir, hash.slice(0, 2), hash.slice(2, 4), hash))).toBe(true);
  });

  it('getBlob round-trips the bytes and content type', async () => {
    const store = createFsBlobStore(freshDir());
    const { hash } = await store.putBlob(enc('hello'), 'image/png');
    const got = await store.getBlob(hash);
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello');
    expect(got!.contentType).toBe('image/png');
  });

  it('is idempotent and keeps the first content type', async () => {
    const store = createFsBlobStore(freshDir());
    const a = await store.putBlob(enc('hello'), 'image/png');
    await store.putBlob(enc('hello'), 'text/plain');
    expect((await store.getBlob(a.hash))!.contentType).toBe('image/png');
  });

  it('getBlob returns null for an unknown hash', async () => {
    expect(await createFsBlobStore(freshDir()).getBlob('deadbeef')).toBeNull();
  });

  it('round-trips arbitrary binary bytes losslessly', async () => {
    const store = createFsBlobStore(freshDir());
    const bytes = new Uint8Array([0, 255, 1, 254, 128, 0, 42]);
    const { hash } = await store.putBlob(bytes, 'application/octet-stream');
    expect(Array.from((await store.getBlob(hash))!.bytes)).toEqual([0, 255, 1, 254, 128, 0, 42]);
  });

  it('persists across store instances (bytes are on disk)', async () => {
    const dir = freshDir();
    const { hash } = await createFsBlobStore(dir).putBlob(enc('persist me'), 'text/plain');
    expect(new TextDecoder().decode((await createFsBlobStore(dir).getBlob(hash))!.bytes)).toBe('persist me');
  });

  it('defaults an omitted content type to null', async () => {
    const store = createFsBlobStore(freshDir());
    const { hash } = await store.putBlob(enc('x'));
    expect((await store.getBlob(hash))!.contentType).toBeNull();
  });
});
