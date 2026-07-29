export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

// SVG is excluded on purpose: blobs are served from the app's own origin, so an SVG opened directly would run its scripts there.
export const ACCEPTED_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const;

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

// One definition of an acceptable upload, shared by the daemon that enforces it and the widgets that check before sending.
export function assetUploadProblem(size: number, contentType: string | null): string | null {
  if (size === 0) return 'empty upload';
  if (size > MAX_ASSET_BYTES) return `file is ${megabytes(size)}, over the ${megabytes(MAX_ASSET_BYTES)} limit`;
  if (contentType === null || !(ACCEPTED_ASSET_TYPES as readonly string[]).includes(contentType)) {
    return `unsupported file type '${contentType ?? 'unknown'}': PNG, JPEG, GIF, WebP or AVIF only`;
  }
  return null;
}
