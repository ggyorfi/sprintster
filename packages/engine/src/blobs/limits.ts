export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

// SVG is excluded on purpose: blobs are served from the app's own origin, so an SVG opened directly would run its scripts there.
export const ACCEPTED_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const;

// Enough leading bytes to identify every accepted format; AVIF needs 12.
export const ASSET_HEADER_BYTES = 16;

function startsWith(bytes: Uint8Array, offset: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, i) => bytes[offset + i] === byte);
}

// The bytes decide the type, never the client's declared one: a label is chosen by the caller and can lie.
export function sniffImageType(header: Uint8Array): string | null {
  if (hasBytes(header, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (hasBytes(header, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(header, 0, 'GIF8')) return 'image/gif';
  if (startsWith(header, 0, 'RIFF') && startsWith(header, 8, 'WEBP')) return 'image/webp';
  if (startsWith(header, 4, 'ftyp') && (startsWith(header, 8, 'avif') || startsWith(header, 8, 'avis'))) {
    return 'image/avif';
  }
  return null;
}

function looksLikeSvg(header: Uint8Array): boolean {
  const text = new TextDecoder().decode(header.subarray(0, ASSET_HEADER_BYTES)).trimStart().toLowerCase();
  return text.startsWith('<svg') || text.startsWith('<?xml');
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

const ACCEPTED = 'PNG, JPEG, GIF, WebP or AVIF only';

// One definition of an acceptable upload, shared by the daemon that enforces it and the widgets that check before sending.
export function assetUploadProblem(size: number, header: Uint8Array): string | null {
  if (size === 0) return 'empty upload';
  if (size > MAX_ASSET_BYTES) return `file is ${megabytes(size)}, over the ${megabytes(MAX_ASSET_BYTES)} limit`;
  if (sniffImageType(header) !== null) return null;
  if (looksLikeSvg(header)) return `SVG is not accepted: ${ACCEPTED}`;
  return `unrecognised image data: ${ACCEPTED}`;
}
