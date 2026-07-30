const ASSET_HASH_URL = /\/assets\/([0-9a-f]{64})/g;

export type SkipReason = 'unknown' | 'ambiguous';

export interface AssetUrlRewrite {
  body: string;
  skipped: ReadonlyArray<{ hash: string; reason: SkipReason }>;
}

// null marks a hash held by more than one asset: nothing can say which one a body meant, so it is left alone.
export function assetIdsByHash(
  rows: ReadonlyArray<Record<string, unknown>>,
  fileProperty: string,
): Map<string, string | null> {
  const byHash = new Map<string, string | null>();
  for (const row of rows) {
    const file = row[fileProperty];
    if (file === null || typeof file !== 'object') continue;
    const hash = (file as { hash?: unknown }).hash;
    const id = row['id'];
    if (typeof hash !== 'string' || typeof id !== 'string') continue;
    byHash.set(hash, byHash.has(hash) ? null : id);
  }
  return byHash;
}

// Bodies written before assets existed point at the bytes; rewriting them is what makes a replacement reach prose.
export function rewriteAssetUrls(body: string, byHash: ReadonlyMap<string, string | null>): AssetUrlRewrite {
  const skipped: Array<{ hash: string; reason: SkipReason }> = [];
  const seen = new Set<string>();
  const next = body.replace(ASSET_HASH_URL, (whole, hash: string) => {
    const id = byHash.get(hash);
    if (typeof id === 'string') return `/assets/${id}`;
    if (!seen.has(hash)) {
      seen.add(hash);
      skipped.push({ hash, reason: byHash.has(hash) ? 'ambiguous' : 'unknown' });
    }
    return whole;
  });
  return { body: next, skipped };
}
