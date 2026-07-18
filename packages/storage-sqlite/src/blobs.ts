import type Database from 'better-sqlite3';
import { sha256Hex, type BlobData, type BlobRef, type BlobStore } from '@sprintster/engine';

const DDL = `
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  content_type TEXT,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function createSqliteBlobStore(db: Database.Database): BlobStore {
  db.exec(DDL);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO blobs (hash, content_type, size, bytes, created_at)
     VALUES (@hash, @content_type, @size, @bytes, @created_at)`,
  );
  const get = db.prepare(`SELECT content_type, bytes FROM blobs WHERE hash = ?`);
  const exists = db.prepare(`SELECT 1 FROM blobs WHERE hash = ?`);

  return {
    async putBlob(bytes: Uint8Array, contentType: string | null = null): Promise<BlobRef> {
      const hash = await sha256Hex(bytes);
      insert.run({
        hash,
        content_type: contentType,
        size: bytes.byteLength,
        bytes: Buffer.from(bytes),
        created_at: new Date().toISOString(),
      });
      return { hash, size: bytes.byteLength };
    },

    async getBlob(hash: string): Promise<BlobData | null> {
      const row = get.get(hash) as { content_type: string | null; bytes: Buffer } | undefined;
      if (row === undefined) return null;
      return { bytes: new Uint8Array(row.bytes), contentType: row.content_type };
    },

    async hasBlob(hash: string): Promise<boolean> {
      return exists.get(hash) !== undefined;
    },
  };
}
