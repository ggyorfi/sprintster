import * as vitest from 'vitest';
import { env } from 'cloudflare:test';
import { describeBlobStore } from '@sprintster/engine/testing';
import { createR2BlobStore, type R2BucketLike } from './r2-blob-store.js';

// Storage is shared across the cases in this file, so each store gets keys of its own.
function freshBucket(): R2BucketLike {
  const bucket = env.BLOBS as unknown as R2BucketLike;
  const prefix = `${crypto.randomUUID()}/`;
  return {
    head: (key) => bucket.head(prefix + key),
    get: (key) => bucket.get(prefix + key),
    put: (key, value, options) => bucket.put(prefix + key, value, options),
  };
}

describeBlobStore(vitest, 'r2', () => createR2BlobStore(freshBucket()));

vitest.describe('createR2BlobStore', () => {
  vitest.it('writes nothing for a second put of the same bytes', async () => {
    const bucket = freshBucket();
    let puts = 0;
    const store = createR2BlobStore({ ...bucket, put: (key, value, options) => (puts++, bucket.put(key, value, options)) });
    await store.putBlob(new TextEncoder().encode('once'), 'text/plain');
    await store.putBlob(new TextEncoder().encode('once'), 'text/plain');
    vitest.expect(puts).toBe(1);
  });
});
