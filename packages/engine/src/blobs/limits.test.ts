import { describe, it, expect } from 'vitest';
import { assetUploadProblem, MAX_ASSET_BYTES } from './limits.js';

describe('assetUploadProblem', () => {
  it('accepts each supported image type', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']) {
      expect(assetUploadProblem(1024, type)).toBeNull();
    }
  });

  it('rejects an empty upload', () => {
    expect(assetUploadProblem(0, 'image/png')).toBe('empty upload');
  });

  it('accepts a file exactly on the limit and rejects one over it', () => {
    expect(assetUploadProblem(MAX_ASSET_BYTES, 'image/png')).toBeNull();
    expect(assetUploadProblem(MAX_ASSET_BYTES + 1, 'image/png')).toMatch(/over the 10 MB limit/);
  });

  it('names the offending type, and reports a missing one', () => {
    expect(assetUploadProblem(10, 'application/pdf')).toMatch(/application\/pdf/);
    expect(assetUploadProblem(10, null)).toMatch(/unknown/);
  });

  it('rejects SVG, which would run its scripts on our own origin', () => {
    expect(assetUploadProblem(10, 'image/svg+xml')).not.toBeNull();
  });
});
