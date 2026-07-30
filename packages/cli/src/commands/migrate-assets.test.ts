import { describe, it, expect } from 'vitest';
import { createObjectApi, InMemoryEventStore, loadConfig, type ObjectConfig } from '@sprintster/engine';
import { migrateAssetBodies } from './migrate-assets.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';

function config() {
  return loadConfig({
    version: '1',
    assets: 'asset',
    objects: [
      {
        name: 'asset',
        title: 'Asset',
        titlePlural: 'Assets',
        route: 'media',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'file', type: 'image', title: 'File' },
          { name: 'removed', type: 'boolean', system: true },
        ],
        lists: [{ name: 'default', title: 'Assets', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
      },
      {
        name: 'post',
        title: 'Post',
        titlePlural: 'Posts',
        lifecycle: { softDelete: 'removed' },
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'body', type: 'markdown', title: 'Body' },
          { name: 'removed', type: 'boolean', system: true },
        ],
        lists: [{ name: 'default', title: 'Posts', columns: [{ property: 'id', label: 'ID', width: 10 }] }],
      },
    ],
  });
}

async function seed(body: string, opts: { withAsset?: boolean } = {}) {
  const cfg = config();
  const store = new InMemoryEventStore();
  const [assetObj, postObj] = cfg.objects as ObjectConfig[];
  const assets = createObjectApi<{ id: string }>(store, assetObj!);
  const posts = createObjectApi<{ id: string }>(store, postObj!);
  if (opts.withAsset !== false) {
    await assets.add!({ id: ASSET_ID, file: { hash: HASH_A, filename: 'h.png', contentType: 'image/png', size: 3 } });
  }
  await posts.add!({ id: POST_ID, body });
  const bodyOf = async () => ((await posts.get(POST_ID)) as unknown as { body: string }).body;
  return { cfg, store, bodyOf };
}

describe('migrateAssetBodies', () => {
  it('rewrites a hash URL to the asset holding that file', async () => {
    const { cfg, store, bodyOf } = await seed(`Intro\n\n![A cover](/assets/${HASH_A})\n\nOutro`);
    const report = await migrateAssetBodies(cfg.objects, 'asset', store, false);
    expect(report.rewritten).toBe(1);
    expect(report.records).toBe(1);
    expect(await bodyOf()).toContain(`/assets/${ASSET_ID}`);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { cfg, store, bodyOf } = await seed(`![](/assets/${HASH_A})`);
    await migrateAssetBodies(cfg.objects, 'asset', store, false);
    const after = await bodyOf();
    const second = await migrateAssetBodies(cfg.objects, 'asset', store, false);
    expect(second.rewritten).toBe(0);
    expect(await bodyOf()).toBe(after);
  });

  it('leaves a hash no asset holds alone, and reports it', async () => {
    const { cfg, store, bodyOf } = await seed(`![](/assets/${HASH_B})`);
    const report = await migrateAssetBodies(cfg.objects, 'asset', store, false);
    expect(report.rewritten).toBe(0);
    expect(report.skipped.get(HASH_B)).toBe('unknown');
    expect(await bodyOf()).toContain(`/assets/${HASH_B}`);
  });

  it('writes nothing on a dry run, but still reports what would change', async () => {
    const { cfg, store, bodyOf } = await seed(`![](/assets/${HASH_A})`);
    const report = await migrateAssetBodies(cfg.objects, 'asset', store, true);
    expect(report.rewritten).toBe(1);
    expect(await bodyOf()).toContain(`/assets/${HASH_A}`);
  });

  it('records the rewrite as an ordinary event rather than editing history', async () => {
    const { cfg, store } = await seed(`![](/assets/${HASH_A})`);
    const before = (await store.findByStream(0, 'post', POST_ID)).length;
    await migrateAssetBodies(cfg.objects, 'asset', store, false);
    const after = await store.findByStream(0, 'post', POST_ID);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]?.eventType).toMatch(/Changed/);
  });
});
