import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { appConfig, assetContentType, assetUploadProblem, isApiError, MAX_ASSET_BYTES, uploadOptions, type BlobApi } from '@sprintster/engine';
import { blobResponse } from '../blob-response.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
// An asset URL resolves to whatever file the record holds now, so it is revalidated rather than cached forever.
const REVALIDATED = 'public, max-age=60';
const SHA256 = /^[0-9a-f]{64}$/;

export type AssetHashResolver = (id: string) => Promise<string | null>;

export function createAssetRoute(blobApi: BlobApi, resolveAssetHash?: AssetHashResolver, actorOf: (c: Context) => string | undefined = () => undefined): Hono {
  const route = new Hono();

  route.post('/', async (c) => {
    try {
      const field = (await c.req.parseBody())['file'];
      if (!(field instanceof File)) {
        return c.json({ code: 'bad_request', message: 'expected a multipart field named "file"' }, 400);
      }
      const bytes = new Uint8Array(await field.arrayBuffer());
      const opts = uploadOptions(appConfig.uploads);
      const problem = assetUploadProblem(bytes.byteLength, bytes, opts);
      if (problem !== null) {
        const tooLarge = bytes.byteLength > (opts.maxBytes ?? MAX_ASSET_BYTES);
        return c.json({ code: tooLarge ? 'too_large' : 'bad_request', message: problem }, tooLarge ? 413 : 400);
      }
      const contentType = assetContentType(bytes, field.name, opts);
      const ref = await blobApi.upload(bytes, contentType, actorOf(c));
      return c.json({ hash: ref.hash, size: ref.size, contentType, filename: field.name }, 201);
    } catch (err) {
      return apiErrorResponse(c, err);
    }
  });

  route.on(['GET', 'HEAD'], '/:key', async (c, next) => {
    const key = c.req.param('key');
    if (SHA256.test(key)) return serve(c, key, IMMUTABLE);
    // Only claim paths that could be a blob or an asset id, so static files under /assets fall through.
    if (resolveAssetHash === undefined || key.includes('.')) return next();
    const hash = await resolveAssetHash(key);
    if (hash === null) return next();
    return serve(c, hash, REVALIDATED);
  });

  async function serve(c: Context, hash: string, cacheControl: string): Promise<Response> {
    const res = await blobResponse(blobApi, hash, c.req.raw, { cacheControl });
    return res ?? c.json({ code: 'not_found', message: 'blob not found' }, 404);
  }

  return route;
}

function apiErrorResponse(c: Context, err: unknown): Response {
  if (isApiError(err)) {
    return c.json({ code: err.code, message: err.message }, err.statusCode as ContentfulStatusCode);
  }
  throw err;
}
