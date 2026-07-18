import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { sha256Hex, type BlobData, type BlobRef, type BlobStore } from '@sprintster/engine';

function blobPath(root: string, hash: string): string {
  return join(root, hash.slice(0, 2), hash.slice(2, 4), hash);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

// Content-addressed blob store on the filesystem: bytes as immutable files sharded by hash prefix, content type in a sibling `.type` file.
export function createFsBlobStore(root: string): BlobStore {
  return {
    async putBlob(bytes: Uint8Array, contentType: string | null = null): Promise<BlobRef> {
      const hash = await sha256Hex(bytes);
      const file = blobPath(root, hash);
      if (!(await pathExists(file))) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(`${file}.type`, contentType ?? '');
        const tmp = `${file}.${crypto.randomUUID()}.tmp`;
        await writeFile(tmp, bytes);
        await rename(tmp, file);
      }
      return { hash, size: bytes.byteLength };
    },

    async getBlob(hash: string): Promise<BlobData | null> {
      const file = blobPath(root, hash);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await readFile(file));
      } catch (err) {
        if (isEnoent(err)) return null;
        throw err;
      }
      let contentType: string | null = null;
      try {
        const text = await readFile(`${file}.type`, 'utf8');
        contentType = text === '' ? null : text;
      } catch (err) {
        if (!isEnoent(err)) throw err;
      }
      return { bytes, contentType };
    },

    async hasBlob(hash: string): Promise<boolean> {
      return pathExists(blobPath(root, hash));
    },
  };
}
