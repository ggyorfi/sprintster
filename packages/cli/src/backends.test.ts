import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBackend } from './backends.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('openBackend', () => {
  it('opens a sqlite :memory: backend with a working store', async () => {
    const backend = await openBackend({ kind: 'sqlite', path: ':memory:' }, '.sprintster/binary-data');
    const row = await backend.store.append({
      partitionId: 0,
      streamType: 't',
      streamId: 's',
      streamVersion: 1,
      eventType: 'E',
      eventVersion: 1,
      payload: { a: 1 },
      occurredAt: '2026-01-01T00:00:00.000Z',
      actor: 'test',
      correlationId: null,
    });
    expect(row.id).toBeTypeOf('string');
    expect(await backend.store.streamHead(0, 't', 's')).toBe(1);
    await backend.close();
  });

  it('gives a :memory: backend an in-memory blob store', async () => {
    const backend = await openBackend({ kind: 'sqlite', path: ':memory:' }, '.sprintster/binary-data');
    const ref = await backend.blobStore.putBlob(new TextEncoder().encode('hi'), 'text/plain');
    const got = await backend.blobStore.getBlob(ref.hash);
    expect(new TextDecoder().decode(got!.bytes)).toBe('hi');
    expect(await backend.blobStore.hasBlob(ref.hash)).toBe(true);
    await backend.close();
  });

  it('writes blobs to the configured blob dir for a file-backed sqlite db (never in the db)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprintster-be-'));
    tmpDirs.push(dir);
    const blobDir = join(dir, 'assets');
    const backend = await openBackend({ kind: 'sqlite', path: join(dir, 'dev.db') }, blobDir);
    const ref = await backend.blobStore.putBlob(new TextEncoder().encode('hi'), 'text/plain');
    const file = join(blobDir, ref.hash.slice(0, 2), ref.hash.slice(2, 4), ref.hash);
    expect(existsSync(file)).toBe(true);
    expect(new TextDecoder().decode((await backend.blobStore.getBlob(ref.hash))!.bytes)).toBe('hi');
    await backend.close();
  });
});
