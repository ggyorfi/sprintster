export interface BlobRef {
  hash: string;
  size: number;
}

export interface BlobData {
  bytes: Uint8Array;
  contentType: string | null;
}

// Content-addressed binary store: bytes keyed by their sha256, kept outside the event log so historical events never break.
export interface BlobStore {
  putBlob(bytes: Uint8Array, contentType?: string | null): Promise<BlobRef>;
  getBlob(hash: string): Promise<BlobData | null>;
  hasBlob(hash: string): Promise<boolean>;
}

// Isomorphic sha256 (Web Crypto, available in Node 22 and browsers) so the engine stays free of node-only imports.
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class InMemoryBlobStore implements BlobStore {
  private blobs = new Map<string, { bytes: Uint8Array; contentType: string | null }>();

  async putBlob(bytes: Uint8Array, contentType: string | null = null): Promise<BlobRef> {
    const hash = await sha256Hex(bytes);
    if (!this.blobs.has(hash)) {
      this.blobs.set(hash, { bytes: Uint8Array.from(bytes), contentType });
    }
    return { hash, size: bytes.byteLength };
  }

  async getBlob(hash: string): Promise<BlobData | null> {
    const blob = this.blobs.get(hash);
    return blob === undefined ? null : { bytes: blob.bytes, contentType: blob.contentType };
  }

  async hasBlob(hash: string): Promise<boolean> {
    return this.blobs.has(hash);
  }
}
