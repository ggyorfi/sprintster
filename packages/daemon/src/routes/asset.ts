import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { isApiError, type BlobApi } from '@sprintster/engine';

const IMMUTABLE = 'public, max-age=31536000, immutable';

export function createAssetRoute(blobApi: BlobApi): Hono {
  const route = new Hono();

  route.post('/', async (c) => {
    try {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) return c.json({ code: 'bad_request', message: 'empty upload' }, 400);
      const contentType = c.req.header('content-type') ?? null;
      const ref = await blobApi.upload(bytes, contentType);
      return c.json({ hash: ref.hash, size: ref.size, contentType }, 201);
    } catch (err) {
      return apiErrorResponse(c, err);
    }
  });

  route.get('/:hash', async (c) => {
    const blob = await blobApi.get(c.req.param('hash'));
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
