import { useState } from 'react';
import type { UploadedAsset } from '../api/assets.js';

export interface AssetUpload {
  busy: boolean;
  error: string | null;
  select: (file: File | undefined) => Promise<UploadedAsset | null>;
}

// Shared by every widget that uploads: the stored shapes differ, the upload, busy and error handling does not.
export function useAssetUpload(upload: (file: File) => Promise<UploadedAsset>): AssetUpload {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(file: File | undefined): Promise<UploadedAsset | null> {
    if (file === undefined) return null;
    setBusy(true);
    setError(null);
    try {
      return await upload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, select };
}
