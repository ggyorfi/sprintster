import { resolveApiBaseUrl } from './config.js';

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
