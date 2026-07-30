import { defineCommand } from 'citty';
import {
  assetIdsByHash,
  createObjectApi,
  rewriteAssetUrls,
  type ObjectConfig,
  type SkipReason,
} from '@sprintster/engine';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { failClean } from '../fail.js';

export interface Report {
  rewritten: number;
  records: number;
  skipped: Map<string, SkipReason>;
}

function markdownProperties(obj: ObjectConfig): string[] {
  return obj.properties.filter((p) => p.type === 'markdown').map((p) => p.name);
}

export const migrateAssetsCommand = defineCommand({
  meta: {
    name: 'migrate-assets',
    description: 'Rewrite /assets/<hash> URLs in markdown bodies to the asset records that hold those files',
  },
  args: {
    env: { type: 'string', description: 'environment to migrate', default: 'dev' },
    'dry-run': { type: 'boolean', description: 'report what would change without writing', default: false },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const assetsName = project.app.assets;
      if (assetsName === undefined) {
        throw new Error("this project names no 'assets' object, so there is nothing to migrate bodies to");
      }
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend, environment.blobs.dir);
      try {
        const report = await migrateAssetBodies(project.app.objects, assetsName, backend.store, args['dry-run']);
        print(report, args['dry-run']);
      } finally {
        await backend.close();
      }
    } catch (err) {
      failClean(err);
    }
  },
});

export async function migrateAssetBodies(
  objects: ReadonlyArray<ObjectConfig>,
  assetsName: string,
  store: Parameters<typeof createObjectApi>[0],
  dryRun: boolean,
): Promise<Report> {
  const assetObj = objects.find((o) => o.name === assetsName);
  if (assetObj === undefined) throw new Error(`'assets' names unknown object '${assetsName}'`);
  const fileProperty = assetObj.properties.find((p) => p.type === 'image');
  if (fileProperty === undefined) throw new Error(`assets object '${assetsName}' has no image property`);

  const assetApi = createObjectApi<{ id: string }>(store, assetObj);
  const byHash = assetIdsByHash((await assetApi.list()) as Array<Record<string, unknown>>, fileProperty.name);

  const report: Report = { rewritten: 0, records: 0, skipped: new Map() };
  for (const obj of objects) {
    const fields = markdownProperties(obj);
    if (fields.length === 0) continue;
    const api = createObjectApi<{ id: string }>(store, obj);
    for (const row of (await api.list()) as Array<Record<string, unknown>>) {
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        const body = row[field];
        if (typeof body !== 'string') continue;
        const result = rewriteAssetUrls(body, byHash);
        for (const skip of result.skipped) report.skipped.set(skip.hash, skip.reason);
        if (result.body !== body) patch[field] = result.body;
      }
      const changed = Object.keys(patch);
      if (changed.length === 0) continue;
      report.records += 1;
      report.rewritten += changed.length;
      // An ordinary update, so the rewrite is a recorded event rather than an edit behind the log.
      if (!dryRun) await api.update!(String(row['id']), patch);
    }
  }
  return report;
}

function print(report: Report, dryRun: boolean): void {
  const verb = dryRun ? 'would rewrite' : 'rewrote';
  console.log(`${verb} ${report.rewritten} field(s) across ${report.records} record(s)`);
  for (const [hash, reason] of report.skipped) {
    const why = reason === 'unknown' ? 'no asset holds this file' : 'more than one asset holds this file';
    console.log(`  left alone /assets/${hash}: ${why}`);
  }
}
