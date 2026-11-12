import { isImageType } from '@sprintster/engine';

export interface BlobResponseOptions {
  cacheControl?: string;
  // Offered as the saved file's name; ASCII only, as Content-Disposition's plain form takes it.
  filename?: string;
}

// ADR 23: one blob as a Response, for the daemon and for any public host in front of the same store (Node or a Worker).
// Only an image opens inline; everything else downloads, so no file runs on the origin serving it (ADR 19).
export async function blobResponse(
  blobs: { get(hash: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> },
  hash: string,
  request: Request,
  opts: BlobResponseOptions = {},
): Promise<Response | null> {
  const blob = await blobs.get(hash);
  if (blob === null) return null;
  const etag = `"${hash}"`;
  const contentType = blob.contentType ?? 'application/octet-stream';
  const name = opts.filename?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
    ...(opts.cacheControl === undefined ? {} : { 'Cache-Control': opts.cacheControl }),
    ...(isImageType(contentType) ? {} : { 'Content-Disposition': name === undefined ? 'attachment' : `attachment; filename="${name}"` }),
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : (blob.bytes as BodyInit), { headers });
}
