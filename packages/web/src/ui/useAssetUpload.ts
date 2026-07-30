import { useState } from 'react';
import { assetUploadProblem, ASSET_HEADER_BYTES } from '@sprintster/engine';

export interface AssetUpload<T> {
  busy: boolean;
  error: string | null;
  select: (file: File | undefined) => Promise<T | null>;
}

// Shared by every widget that uploads: the stored shapes differ, the upload, busy and error handling does not.
export function useAssetUpload<T>(upload: ((file: File) => Promise<T>) | undefined): AssetUpload<T> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(file: File | undefined): Promise<T | null> {
    if (file === undefined || upload === undefined) return null;
    // The daemon is what enforces this; checking here only saves sending a file we already know it will refuse.
    const header = new Uint8Array(await file.slice(0, ASSET_HEADER_BYTES).arrayBuffer());
    const problem = assetUploadProblem(file.size, header);
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
