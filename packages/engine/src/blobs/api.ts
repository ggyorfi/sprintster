import { UniqueViolationError, type EventStore } from '../events/store.js';
import { nowAsIso } from '../time/index.js';
import type { BlobData, BlobRef, BlobStore } from './store.js';

// Internal stream recording each uploaded blob as a fact; streamId is the content hash, so re-uploads are idempotent.
const BLOB_STREAM_TYPE = '__blob';

export interface BlobApi {
  upload(bytes: Uint8Array, contentType?: string | null, actor?: string): Promise<BlobRef>;
  get(hash: string): Promise<BlobData | null>;
  has(hash: string): Promise<boolean>;
}

export interface CreateBlobApiOptions {
  partitionId?: number;
  actor?: string;
}

export function createBlobApi(events: EventStore, blobs: BlobStore, options: CreateBlobApiOptions = {}): BlobApi {
  const partitionId = options.partitionId ?? 0;
  const defaultActor = options.actor ?? 'mihaly';

  async function upload(
    bytes: Uint8Array,
    contentType: string | null = null,
    actor: string = defaultActor,
  ): Promise<BlobRef> {
    const ref = await blobs.putBlob(bytes, contentType);
    try {
      await events.append({
        partitionId,
        streamType: BLOB_STREAM_TYPE,
        streamId: ref.hash,
        streamVersion: 1,
        eventType: 'BlobUploaded',
        eventVersion: 1,
        payload: { hash: ref.hash, size: ref.size, contentType },
        occurredAt: nowAsIso(),
        actor,
        correlationId: null,
      });
    } catch (err) {
      if (!(err instanceof UniqueViolationError)) throw err;
    }
    return ref;
  }

  return {
    upload,
    get: (hash) => blobs.getBlob(hash),
    has: (hash) => blobs.hasBlob(hash),
  };
}
