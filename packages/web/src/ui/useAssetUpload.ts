import { useState } from 'react';
import { assetUploadProblem } from '@sprintster/engine';
import type { UploadedAsset } from '../api/assets.js';

export interface AssetUpload {
  busy: boolean;
  error: string | null;
  select: (file: File | undefined) => Promise<UploadedAsset | null>;
}

// Shared by every widget that uploads: the stored shapes differ, the upload, busy and error handling does not.
export function useAssetUpload(upload: ((file: File) => Promise<UploadedAsset>) | undefined): AssetUpload {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(file: File | undefined): Promise<UploadedAsset | null> {
    if (file === undefined || upload === undefined) return null;
    // The daemon is what enforces this; checking here only saves sending a file we already know it will refuse.
    const problem = assetUploadProblem(file.size, file.type === '' ? null : file.type);
    if (problem !== null) {
      setError(problem);
      return null;
    }
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
