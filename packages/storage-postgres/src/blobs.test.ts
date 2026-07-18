import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import { createPgBlobStore, type BlobStoreDatabase } from './blobs.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const HELLO_SHA = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

// A minimal fake over an in-memory map, exercising exactly the Kysely chains the store calls (no real database).
function fakeDb() {
  const rows = new Map<string, { content_type: string | null; size: string; bytes: Buffer }>();
  const db = {
    insertInto() {
      let vals: { hash: string; content_type: string | null; size: string; bytes: Buffer };
      const b = {
        values(v: typeof vals) {
          vals = v;
          return b;
        },
        onConflict(cb: (oc: { column: () => unknown; doNothing: () => unknown }) => unknown) {
          const oc = { column: () => oc, doNothing: () => oc };
          cb(oc);
          return b;
        },
        async execute() {
          if (!rows.has(vals.hash)) rows.set(vals.hash, { content_type: vals.content_type, size: vals.size, bytes: vals.bytes });
          return [];
        },
      };
      return b;
    },
    selectFrom() {
      let filter: string | undefined;
      const b = {
        select() {
          return b;
        },
        where(_col: string, _op: string, val: string) {
          filter = val;
          return b;
        },
        async executeTakeFirst() {
          const r = filter !== undefined ? rows.get(filter) : undefined;
          return r === undefined ? undefined : { hash: filter, content_type: r.content_type, bytes: r.bytes };
        },
      };
      return b;
    },
  };
  return db as unknown as Kysely<BlobStoreDatabase>;
}

describe('createPgBlobStore (fake db)', () => {
  it('putBlob returns the content hash and size, and stores the value', async () => {
    const store = createPgBlobStore(fakeDb());
    const ref = await store.putBlob(enc('hello'), 'image/png');
    expect(ref.hash).toBe(HELLO_SHA);
    expect(ref.size).toBe(5);
  });

  it('getBlob round-trips the bytes and content type', async () => {
    const store = createPgBlobStore(fakeDb());
    const { hash } = await store.putBlob(enc('hello'), 'image/png');
    const got = await store.getBlob(hash);
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello');
    expect(got!.contentType).toBe('image/png');
  });

  it('is idempotent: ON CONFLICT DO NOTHING keeps the first content type', async () => {
    const store = createPgBlobStore(fakeDb());
    const a = await store.putBlob(enc('hello'), 'image/png');
    await store.putBlob(enc('hello'), 'text/plain');
    expect((await store.getBlob(a.hash))!.contentType).toBe('image/png');
  });

  it('getBlob returns null for an unknown hash and hasBlob reflects presence', async () => {
    const store = createPgBlobStore(fakeDb());
    const { hash } = await store.putBlob(enc('x'));
    expect(await store.getBlob('nope')).toBeNull();
    expect(await store.hasBlob(hash)).toBe(true);
    expect(await store.hasBlob('nope')).toBe(false);
  });
});

describe('createPgBlobStore', () => {
  it('returns a BlobStore exposing the interface methods', () => {
    const store = createPgBlobStore({} as Kysely<BlobStoreDatabase>);
    expect(typeof store.putBlob).toBe('function');
    expect(typeof store.getBlob).toBe('function');
    expect(typeof store.hasBlob).toBe('function');
  });
});
