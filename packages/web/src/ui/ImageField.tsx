import { isImageType } from '@sprintster/engine';
import { TextField } from './TextField.js';
import { anyFileAllowed, useAssetUpload } from './useAssetUpload.js';
import type { UploadedAsset } from '../api/assets.js';
import styles from './ImageField.module.css';

export interface ImageValue {
  hash: string;
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  alt?: string;
  thumb?: string;
}

export interface ImageFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  upload: (file: File) => Promise<UploadedAsset>;
  assetUrl: (hash: string) => string;
  readOnly?: boolean;
  // A file property: also takes a PDF, which shows as its name rather than a picture.
  files?: boolean;
}

export function parseImageValue(value: string): ImageValue | null {
  if (value.trim() === '') return null;
  try {
    const v: unknown = JSON.parse(value);
    return v !== null && typeof v === 'object' && typeof (v as { hash?: unknown }).hash === 'string'
      ? (v as ImageValue)
      : null;
  } catch {
    return null;
  }
}

// Read intrinsic dimensions client-side (best-effort); unavailable in jsdom / on failure, so image processing stays CMS-owned.
async function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

export function ImageField({ label, value, onChange, upload, assetUrl, readOnly = false, files = false }: ImageFieldProps) {
  const image = parseImageValue(value);
  const pictured = image !== null && isImageType(image.contentType);
  const { busy, error, select } = useAssetUpload(upload, { imagesOnly: !files });

  async function onFile(file: File | undefined) {
    if (file === undefined) return;
    const [asset, dims] = await Promise.all([select(file), readImageSize(file)]);
    if (asset === null) return;
    const next: ImageValue = {
      hash: asset.hash,
      filename: asset.filename,
      contentType: asset.contentType,
      size: asset.size,
      ...(asset.thumb !== undefined ? { thumb: asset.thumb } : {}),
      ...(dims !== null ? { width: dims.width, height: dims.height } : {}),
    };
    onChange(JSON.stringify(next));
  }

  function setAlt(alt: string) {
    if (image === null) return;
    onChange(JSON.stringify({ ...image, alt: alt === '' ? undefined : alt }));
  }

  return (
    <div className={styles.field}>
      {label !== undefined && <span className={styles.label}>{label}</span>}

      {image !== null && (
        <div className={styles.preview}>
          {pictured && (
            <img
              className={styles.thumb}
              src={assetUrl(image.hash)}
              alt={image.alt ?? ''}
              onError={(e) => e.currentTarget.setAttribute('data-missing', 'true')}
            />
          )}
          <div className={styles.meta}>
            <span className={styles.filename}>{image.filename}</span>
            {!readOnly && (
              <button type="button" className={styles.remove} onClick={() => onChange('')}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {!readOnly && (
        <label className={styles.upload}>
          {busy ? 'Uploading…' : image !== null ? 'Replace…' : files ? 'Upload file…' : 'Upload image…'}
          <input
            type="file"
            accept={!files ? 'image/*' : anyFileAllowed() ? undefined : 'image/*,application/pdf'}
            className={styles.fileInput}
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      )}

      {pictured && (
        <TextField label="Alt text" value={image.alt ?? ''} onChange={setAlt} readOnly={readOnly} placeholder="Describe the image" />
      )}

      {error !== null && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}
