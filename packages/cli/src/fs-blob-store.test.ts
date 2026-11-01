import * as vitest from 'vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeBlobStore } from '@sprintster/engine/testing';
import { createFsBlobStore } from './fs-blob-store.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'sprintster-blob-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describeBlobStore(vitest, 'filesystem', () => createFsBlobStore(freshDir()));

describe('createFsBlobStore', () => {
  it('shards the file by hash prefix', async () => {
    const dir = freshDir();
    const { hash } = await createFsBlobStore(dir).putBlob(enc('hello'));
    expect(existsSync(join(dir, hash.slice(0, 2), hash.slice(2, 4), hash))).toBe(true);
  });

  it('persists across store instances (bytes are on disk)', async () => {
    const dir = freshDir();
    const { hash } = await createFsBlobStore(dir).putBlob(enc('persist me'), 'text/plain');
    expect(new TextDecoder().decode((await createFsBlobStore(dir).getBlob(hash))!.bytes)).toBe('persist me');
  });
});
