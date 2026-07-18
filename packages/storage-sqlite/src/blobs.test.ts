import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createSqliteBlobStore } from './blobs.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

function fresh() {
  return createSqliteBlobStore(new Database(':memory:'));
}

describe('createSqliteBlobStore', () => {
  it('putBlob stores bytes content-addressed and returns the hash and size', async () => {
    const ref = await fresh().putBlob(enc('hello'), 'image/png');
    expect(ref.hash).toBe(HELLO_SHA);
    expect(ref.size).toBe(5);
  });

  it('getBlob round-trips the bytes and content type', async () => {
    const store = fresh();
    const { hash } = await store.putBlob(enc('hello'), 'image/png');
    const got = await store.getBlob(hash);
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello');
    expect(got!.contentType).toBe('image/png');
  });

  it('is idempotent: INSERT OR IGNORE keeps the first content type', async () => {
    const store = fresh();
    const a = await store.putBlob(enc('hello'), 'image/png');
    const b = await store.putBlob(enc('hello'), 'text/plain');
    expect(a.hash).toBe(b.hash);
    expect((await store.getBlob(a.hash))!.contentType).toBe('image/png');
  });

  it('getBlob returns null for an unknown hash', async () => {
    expect(await fresh().getBlob('nope')).toBeNull();
  });

  it('hasBlob reflects presence', async () => {
    const store = fresh();
    const { hash } = await store.putBlob(enc('x'));
    expect(await store.hasBlob(hash)).toBe(true);
    expect(await store.hasBlob('nope')).toBe(false);
  });

  it('round-trips arbitrary binary bytes losslessly', async () => {
    const store = fresh();
    const bytes = new Uint8Array([0, 255, 1, 254, 128, 0, 0, 42]);
    const { hash } = await store.putBlob(bytes, 'application/octet-stream');
    expect(Array.from((await store.getBlob(hash))!.bytes)).toEqual([0, 255, 1, 254, 128, 0, 0, 42]);
  });

  it('keeps blobs in the db independent of the store instance (survives re-open)', async () => {
    const db = new Database(':memory:');
    const { hash } = await createSqliteBlobStore(db).putBlob(enc('persist me'), 'text/plain');
    const reopened = createSqliteBlobStore(db);
    expect(new TextDecoder().decode((await reopened.getBlob(hash))!.bytes)).toBe('persist me');
  });
});
