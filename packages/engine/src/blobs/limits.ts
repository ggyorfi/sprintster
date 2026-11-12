export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

// SVG is excluded on purpose: blobs are served from the app's own origin, so an SVG opened directly would run its scripts there.
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'] as const;
// Documents are served as downloads, never rendered on the app's origin (ADR 19).
export const ACCEPTED_DOCUMENT_TYPES = ['application/pdf'] as const;
export const ACCEPTED_ASSET_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES] as const;

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

export function sniffAssetType(header: Uint8Array): string | null {
  if (startsWith(header, 0, '%PDF-')) return 'application/pdf';
  return sniffImageType(header);
}

// ADR 23: with `anyFile`, a file that is neither image nor PDF takes its type from its name, never from the client's label.
const TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  epub: 'application/epub+zip',
  notebook: 'application/x-smarttech-notebook',
  flipchart: 'application/x-promethean-flipchart',
};

export function typeByExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return (dot < 0 ? undefined : TYPES_BY_EXTENSION[filename.slice(dot + 1).toLowerCase()]) ?? 'application/octet-stream';
}

export interface UploadOptions {
  imagesOnly?: boolean;
  anyFile?: boolean;
  maxBytes?: number;
}

export function uploadOptions(uploads: { anyFile?: boolean | undefined; maxMegabytes?: number | undefined } | undefined): UploadOptions {
  return {
    ...(uploads?.anyFile === true ? { anyFile: true } : {}),
    ...(uploads?.maxMegabytes === undefined ? {} : { maxBytes: uploads.maxMegabytes * 1024 * 1024 }),
  };
}

export function assetContentType(header: Uint8Array, filename: string, opts: UploadOptions = {}): string | null {
  return sniffAssetType(header) ?? (opts.anyFile === true ? typeByExtension(filename) : null);
}

export function isImageType(contentType: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

function looksLikeSvg(header: Uint8Array): boolean {
  const text = new TextDecoder().decode(header.subarray(0, ASSET_HEADER_BYTES)).trimStart().toLowerCase();
  return text.startsWith('<svg') || text.startsWith('<?xml');
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

const ACCEPTED_IMAGES = 'PNG, JPEG, GIF, WebP or AVIF only';
const ACCEPTED = 'PNG, JPEG, GIF, WebP, AVIF or PDF only';

// One definition of an acceptable upload, shared by the daemon that enforces it and the widgets that check before sending.
export function assetUploadProblem(size: number, header: Uint8Array, opts: UploadOptions = {}): string | null {
  const accepted = opts.imagesOnly === true ? ACCEPTED_IMAGES : ACCEPTED;
  const max = opts.maxBytes ?? MAX_ASSET_BYTES;
  if (size === 0) return 'empty upload';
  if (size > max) return `file is ${megabytes(size)}, over the ${megabytes(max)} limit`;
  if (opts.imagesOnly !== true && opts.anyFile === true) return null;
  if ((opts.imagesOnly === true ? sniffImageType(header) : sniffAssetType(header)) !== null) return null;
  if (looksLikeSvg(header)) return `SVG is not accepted: ${accepted}`;
  return `unrecognised file data: ${accepted}`;
}
