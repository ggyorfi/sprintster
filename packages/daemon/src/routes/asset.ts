import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { assetUploadProblem, isApiError, MAX_ASSET_BYTES, sniffImageType, type BlobApi } from '@sprintster/engine';

const IMMUTABLE = 'public, max-age=31536000, immutable';
// An asset URL resolves to whatever file the record holds now, so it is revalidated rather than cached forever.
const REVALIDATED = 'public, max-age=60';
const SHA256 = /^[0-9a-f]{64}$/;

export type AssetHashResolver = (id: string) => Promise<string | null>;

export function createAssetRoute(blobApi: BlobApi, resolveAssetHash?: AssetHashResolver): Hono {
  const route = new Hono();

  route.post('/', async (c) => {
    try {
      const field = (await c.req.parseBody())['file'];
      if (!(field instanceof File)) {
        return c.json({ code: 'bad_request', message: 'expected a multipart field named "file"' }, 400);
      }
      const bytes = new Uint8Array(await field.arrayBuffer());
      const problem = assetUploadProblem(bytes.byteLength, bytes);
      if (problem !== null) {
        const tooLarge = bytes.byteLength > MAX_ASSET_BYTES;
        return c.json({ code: tooLarge ? 'too_large' : 'bad_request', message: problem }, tooLarge ? 413 : 400);
      }
      const contentType = sniffImageType(bytes);
      const ref = await blobApi.upload(bytes, contentType);
      return c.json({ hash: ref.hash, size: ref.size, contentType, filename: field.name }, 201);
    } catch (err) {
      return apiErrorResponse(c, err);
    }
  });

  route.on(['GET', 'HEAD'], '/:key', async (c, next) => {
    const key = c.req.param('key');
    if (SHA256.test(key)) return serveBlob(c, blobApi, key, IMMUTABLE);
    // Only claim paths that could be a blob or an asset id, so static files under /assets fall through.
    if (resolveAssetHash === undefined || key.includes('.')) return next();
    const hash = await resolveAssetHash(key);
    if (hash === null) return next();
    return serveBlob(c, blobApi, hash, REVALIDATED);
  });

  return route;
}

async function serveBlob(c: Context, blobApi: BlobApi, hash: string, cacheControl: string): Promise<Response> {
  const blob = await blobApi.get(hash);
  if (blob === null) return c.json({ code: 'not_found', message: 'blob not found' }, 404);
  const etag = `"${hash}"`;
  const headers = {
    'Content-Type': blob.contentType ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    ETag: etag,
  };
  if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const body = c.req.method === 'HEAD' ? null : (blob.bytes as BodyInit);
  return new Response(body, { headers });
}

function apiErrorResponse(c: Context, err: unknown): Response {
  if (isApiError(err)) {
    return c.json({ code: err.code, message: err.message }, err.statusCode as ContentfulStatusCode);
  }
  throw err;
}
