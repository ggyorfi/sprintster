import { appConfig, assetFileProperty, displayText, fuzzyFilter, isTranslated, objectRoute, thumbnailHash } from '@sprintster/engine';
import { resolveApiBaseUrl, type ApiEnv } from './config.js';
import { authFetch } from './auth.js';
import { createWebApiClient } from './client.js';

export interface UploadedAsset {
  hash: string;
  filename: string;
  contentType: string;
  size: number;
  thumb?: string;
}

const THUMB_SIZE = 160;

// Lists and pickers show this instead of the original. Best effort: without canvas support the image just has no thumbnail.
async function makeThumbnail(file: File): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
  } catch {
    return null;
  }
}

async function postBlob(blob: Blob, filename: string): Promise<UploadedAsset> {
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await authFetch(`${resolveApiBaseUrl()}/assets`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return (await res.json()) as UploadedAsset;
}

// The engine ApiClient is JSON-only; asset bytes go through a separate multipart POST.
export async function uploadAsset(file: File): Promise<UploadedAsset> {
  const asset = await postBlob(file, file.name);
  const thumb = await makeThumbnail(file);
  if (thumb === null) return asset;
  return { ...asset, thumb: (await postBlob(thumb, 'thumb.webp')).hash };
}

export function assetUrl(hash: string): string {
  return `${resolveApiBaseUrl()}/assets/${hash}`;
}

// Exact inverse of assetUrl: stored content keeps our asset references root-relative, so a body is not tied to the environment it was authored in. Any other URL is content, and passes through untouched.
export function storedAssetUrl(src: string, env?: ApiEnv): string {
  const base = resolveApiBaseUrl(env);
  return src.startsWith(`${base}/assets/`) ? src.slice(base.length) : src;
}

// Inverse of storedAssetUrl for loading: a stored root-relative reference is displayed from wherever the API is mounted.
export function displayedAssetUrl(src: string, env?: ApiEnv): string {
  return src.startsWith('/assets/') ? `${resolveApiBaseUrl(env)}${src}` : src;
}

// A body image points at the asset record, not at the bytes, so inserting one has to create that record.
export async function attachAsset(file: File, opts: { titled?: boolean } = {}): Promise<{ id: string; title: string; thumb: string | undefined }> {
  const name = appConfig.assets;
  const obj = appConfig.objects.find((o) => o.name === name);
  const fileProperty = assetFileProperty(obj);
  if (obj === undefined || fileProperty === undefined) {
    throw new Error('no assets object is configured');
  }
  const asset = await uploadAsset(file);
  const id = globalThis.crypto.randomUUID();
  const title = file.name.replace(/\.[^.]+$/, '');
  // The record is otherwise nameless, so a picker could only label it by its id.
  const textProperty = opts.titled === true ? obj.properties.find((p) => p.type === 'text' && p.system !== true) : undefined;
  const named =
    textProperty === undefined ? {} : { [textProperty.name]: isTranslated(textProperty) ? { [appConfig.locales?.[0] ?? 'en']: title } : title };
  const res = await authFetch(`${resolveApiBaseUrl()}/${objectRoute(obj)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, [fileProperty.name]: asset, ...named }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `could not create the ${obj.name} record (${res.status})`);
  }
  return { id, title, thumb: assetUrl(asset.thumb ?? asset.hash) };
}

export type AssetKind = 'image' | 'file';

export interface AssetChoice {
  value: string;
  label: string;
  thumb?: string | undefined;
}

const BROWSE_PAGE = 50;

// The media library as a picker: the server searches when the list declares search fields, else one listing is filtered here.
export function assetBrowser(kind: AssetKind): (query: string) => Promise<AssetChoice[]> {
  const obj = appConfig.objects.find((o) => o.name === appConfig.assets);
  const file = assetFileProperty(obj);
  if (obj === undefined || file === undefined) return async () => [];
  const label = obj.properties.find((p) => p.type === 'text' && p.system !== true)?.name;
  const fields = label === undefined ? [file.name] : [label, file.name];
  const client = createWebApiClient().object<Record<string, unknown>>(obj.name);
  const blob = (r: Record<string, unknown>) => (r[file.name] ?? null) as { filename?: string; contentType?: string } | null;
  const choices = (rows: Record<string, unknown>[]) =>
    rows
      .filter((r) => kind === 'file' || blob(r)?.contentType?.startsWith('image/') === true)
      .map((r): AssetChoice => {
        const hash = thumbnailHash(r[file.name]);
        const id = String(r['id']);
        return { value: id, label: (label === undefined ? '' : displayText(r[label])) || blob(r)?.filename || id, thumb: hash === null ? undefined : assetUrl(hash) };
      });
  if (obj.lists[0]?.search !== undefined) {
    return async (query) => {
      const q = query.trim();
      return choices((await client.page({ fields, limit: BROWSE_PAGE, ...(q === '' ? {} : { q }) })).rows);
    };
  }
  let all: Promise<AssetChoice[]> | undefined;
  return async (query) => {
    all ??= client.listAll({ fields }).then(choices);
    return fuzzyFilter(await all, query).map((hit) => hit.option);
  };
}
