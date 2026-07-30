import { appConfig, objectRoute } from '@sprintster/engine';
import { resolveApiBaseUrl, type ApiEnv } from './config.js';

export interface UploadedAsset {
  hash: string;
  filename: string;
  contentType: string;
  size: number;
}

// The engine ApiClient is JSON-only; asset bytes go through a separate multipart POST.
export async function uploadAsset(file: File): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${resolveApiBaseUrl()}/assets`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return (await res.json()) as UploadedAsset;
}

export function assetUrl(hash: string): string {
  return `${resolveApiBaseUrl()}/assets/${hash}`;
}

// Exact inverse of assetUrl: stored content keeps our asset references root-relative, so a body is not tied to the environment it was authored in. Any other URL is content, and passes through untouched.
export function storedAssetUrl(src: string, env?: ApiEnv): string {
  const base = resolveApiBaseUrl(env);
  return src.startsWith(`${base}/assets/`) ? src.slice(base.length) : src;
}

// A body image points at the asset record, not at the bytes, so inserting one has to create that record.
export async function attachAsset(file: File): Promise<{ id: string }> {
  const name = appConfig.assets;
  const obj = appConfig.objects.find((o) => o.name === name);
  const fileProperty = obj?.properties.find((p) => p.type === 'image');
  if (obj === undefined || fileProperty === undefined) {
    throw new Error('no assets object is configured');
  }
  const asset = await uploadAsset(file);
  const id = globalThis.crypto.randomUUID();
  const res = await fetch(`${resolveApiBaseUrl()}/${objectRoute(obj)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, [fileProperty.name]: asset }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `could not create the ${obj.name} record (${res.status})`);
  }
  return { id };
}
