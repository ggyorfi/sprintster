import { type Generated, type Kysely } from 'kysely';
import { sha256Hex, type BlobData, type BlobRef, type BlobStore } from '@sprintster/engine';

interface BlobsTable {
  hash: string;
  content_type: string | null;
  size: string; // bigint, round-tripped as a string like the events table's stream_version
  bytes: Buffer; // bytea
  created_at: Generated<Date>;
}

// No in-repo migrations exist for Postgres, so the `blobs` table is provisioned out-of-band, exactly like `events`.
export interface BlobStoreDatabase {
  blobs: BlobsTable;
}

export function createPgBlobStore(db: Kysely<BlobStoreDatabase>): BlobStore {
  return {
    async putBlob(bytes: Uint8Array, contentType: string | null = null): Promise<BlobRef> {
      const hash = await sha256Hex(bytes);
      await db
        .insertInto('blobs')
        .values({
          hash,
          content_type: contentType,
          size: String(bytes.byteLength),
          bytes: Buffer.from(bytes),
        })
        .onConflict((oc) => oc.column('hash').doNothing())
        .execute();
      return { hash, size: bytes.byteLength };
    },

    async getBlob(hash: string): Promise<BlobData | null> {
      const row = await db
        .selectFrom('blobs')
        .select(['content_type', 'bytes'])
        .where('hash', '=', hash)
        .executeTakeFirst();
      if (row === undefined) return null;
      return { bytes: new Uint8Array(row.bytes), contentType: row.content_type };
    },

    async hasBlob(hash: string): Promise<boolean> {
      const row = await db.selectFrom('blobs').select('hash').where('hash', '=', hash).executeTakeFirst();
      return row !== undefined;
    },
  };
}
