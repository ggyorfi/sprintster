import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBlobStore, InMemoryEventStore, createObjectApi, loadConfig, setAppConfig } from '@sprintster/engine';
import { openBackend } from '../backends.js';
import { startDaemon } from '../runtime.js';
import { exportCommand, hashesIn, importCommand } from './transfer.js';

const app = {
  version: '1',
  objects: [
    {
      name: 'asset',
      title: 'Asset',
      titlePlural: 'Media',
      route: 'media',
      lifecycle: { softDelete: 'removed' },
      properties: [
        { name: 'id', type: 'id', strategy: 'uuid', system: true },
        { name: 'file', type: 'image' },
        { name: 'removed', type: 'boolean', system: true },
      ],
    },
  ],
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

describe('hashesIn', () => {
  it('finds every sha256 anywhere in a payload', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    expect(hashesIn([{ file: { hash: a, thumb: b, filename: 'x' } }, 'short'])).toEqual(new Set([a, b]));
  });
});

describe('s8r export and import', () => {
  it('moves the events and the blobs they reference into another app', async () => {
    const dir = mkdtempSync(join(tmpdir(), 's8r-export-'));
    const config = join(dir, 'sprintster.config.json');
    writeFileSync(
      config,
      JSON.stringify({ configVersion: '1', environments: { dev: { backend: { kind: 'sqlite', path: join(dir, 'dev.db') }, blobs: { dir: join(dir, 'blobs-src') } } }, app }),
    );
    const loaded = loadConfig(app);
    setAppConfig(loaded);
    const source = await openBackend({ kind: 'sqlite', path: join(dir, 'dev.db') } as never, join(dir, 'blobs-src'));
    const ref = await source.blobStore.putBlob(png, 'image/png');
    await createObjectApi<{ id: string }>(source.store, loaded.objects[0]!).add!({
      id: '11111111-1111-4111-8111-111111111111',
      file: { hash: ref.hash, filename: 'p.png', contentType: 'image/png', size: png.length },
    });
    await source.close();

    process.env['SPRINTSTER_CONFIG'] = config;
    const out = join(dir, 'export');
    try {
      await (exportCommand as { run: (c: { args: unknown }) => Promise<void> }).run({ args: { dir: out, env: 'dev' } });
    } finally {
      delete process.env['SPRINTSTER_CONFIG'];
    }

    const target = await startDaemon({ config: loaded, store: new InMemoryEventStore(), blobStore: new InMemoryBlobStore(), host: '127.0.0.1', port: 3978 });
    try {
      await (importCommand as { run: (c: { args: unknown }) => Promise<void> }).run({ args: { dir: out, url: 'http://127.0.0.1:3978' } });
      const media = (await (await fetch('http://127.0.0.1:3978/media')).json()) as Array<{ file: { hash: string } }>;
      expect(media).toHaveLength(1);
      expect(new Uint8Array(await (await fetch(`http://127.0.0.1:3978/assets/${media[0]!.file.hash}`)).arrayBuffer())).toEqual(png);
    } finally {
      await target.close();
    }
  });
});
