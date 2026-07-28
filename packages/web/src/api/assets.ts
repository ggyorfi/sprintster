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
