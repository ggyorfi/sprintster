import { sha256Hex, type BlobStore } from '@sprintster/engine';

// The slice of an R2 bucket binding this store uses, so the package needs no Workers type definitions.
export interface R2BucketLike {
  head(key: string): Promise<object | null>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

// Content addressed: the key is the hash, so a second put of the same bytes finds the object and writes nothing.
export function createR2BlobStore(bucket: R2BucketLike): BlobStore {
  return {
    async putBlob(bytes, contentType = null) {
      const hash = await sha256Hex(bytes);
      if ((await bucket.head(hash)) === null) {
        await bucket.put(hash, bytes, contentType === null ? {} : { httpMetadata: { contentType } });
      }
      return { hash, size: bytes.byteLength };
    },

    async getBlob(hash) {
      const object = await bucket.get(hash);
      if (object === null) return null;
      return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? null };
    },

    async hasBlob(hash) {
      return (await bucket.head(hash)) !== null;
    },
  };
}
