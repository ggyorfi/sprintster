import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { assetUploadProblem, isApiError, MAX_ASSET_BYTES, type BlobApi } from '@sprintster/engine';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHA256 = /^[0-9a-f]{64}$/;

export function createAssetRoute(blobApi: BlobApi): Hono {
  const route = new Hono();

  route.post('/', async (c) => {
    try {
      const field = (await c.req.parseBody())['file'];
      if (!(field instanceof File)) {
        return c.json({ code: 'bad_request', message: 'expected a multipart field named "file"' }, 400);
      }
      const bytes = new Uint8Array(await field.arrayBuffer());
      const contentType = field.type === '' ? null : field.type;
      const problem = assetUploadProblem(bytes.byteLength, contentType);
      if (problem !== null) {
        const tooLarge = bytes.byteLength > MAX_ASSET_BYTES;
        return c.json({ code: tooLarge ? 'too_large' : 'bad_request', message: problem }, tooLarge ? 413 : 400);
      }
      const ref = await blobApi.upload(bytes, contentType);
      return c.json({ hash: ref.hash, size: ref.size, contentType, filename: field.name }, 201);
    } catch (err) {
      return apiErrorResponse(c, err);
    }
  });

  route.get('/:hash', async (c, next) => {
    const hash = c.req.param('hash');
    // Only claim paths that could be a blob, so static files under /assets fall through.
    if (!SHA256.test(hash)) return next();
    const blob = await blobApi.get(hash);
    if (blob === null) return c.json({ code: 'not_found', message: 'blob not found' }, 404);
    return new Response(blob.bytes as BodyInit, {
      headers: {
        'Content-Type': blob.contentType ?? 'application/octet-stream',
        'Cache-Control': IMMUTABLE,
      },
    });
  });

  return route;
}

function apiErrorResponse(c: Context, err: unknown): Response {
  if (isApiError(err)) {
    return c.json({ code: err.code, message: err.message }, err.statusCode as ContentfulStatusCode);
  }
  throw err;
}
