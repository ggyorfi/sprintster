import { describe, it, expect } from 'vitest';
import { assetUploadProblem, MAX_ASSET_BYTES, sniffImageType } from './limits.js';

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

const HEADERS: Record<string, Uint8Array> = {
  'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  'image/gif': new Uint8Array([...ascii('GIF89a'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  'image/webp': new Uint8Array([...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8 ')]),
  'image/avif': new Uint8Array([0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('avif'), 0, 0, 0, 0]),
};

const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('sniffImageType', () => {
  it('identifies every accepted format from its leading bytes', () => {
    for (const [type, header] of Object.entries(HEADERS)) {
      expect(sniffImageType(header)).toBe(type);
    }
  });

  it('accepts the avis brand of AVIF', () => {
    const avis = new Uint8Array([0, 0, 0, 0x20, ...ascii('ftyp'), ...ascii('avis'), 0, 0, 0, 0]);
    expect(sniffImageType(avis)).toBe('image/avif');
  });

  it('returns null for anything else', () => {
    expect(sniffImageType(svg)).toBeNull();
    expect(sniffImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(sniffImageType(new Uint8Array(16))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  it('does not mistake a RIFF container that is not WebP', () => {
    const wav = new Uint8Array([...ascii('RIFF'), 0x1a, 0, 0, 0, ...ascii('WAVE'), 0, 0, 0, 0]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe('assetUploadProblem', () => {
  it('accepts every supported format', () => {
    for (const header of Object.values(HEADERS)) {
      expect(assetUploadProblem(1024, header)).toBeNull();
    }
  });

  it('rejects an empty upload', () => {
    expect(assetUploadProblem(0, HEADERS['image/png']!)).toBe('empty upload');
  });

  it('accepts a file exactly on the limit and rejects one over it', () => {
    expect(assetUploadProblem(MAX_ASSET_BYTES, HEADERS['image/png']!)).toBeNull();
    expect(assetUploadProblem(MAX_ASSET_BYTES + 1, HEADERS['image/png']!)).toMatch(/over the 10 MB limit/);
  });

  it('checks size before content, so an oversized file is reported as oversized', () => {
    expect(assetUploadProblem(MAX_ASSET_BYTES + 1, svg)).toMatch(/over the 10 MB limit/);
  });

  it('names SVG specifically, since it is excluded rather than unrecognised', () => {
    expect(assetUploadProblem(100, svg)).toMatch(/SVG is not accepted/);
    const xmlDeclared = new TextEncoder().encode('<?xml version="1.0"?><svg></svg>');
    expect(assetUploadProblem(100, xmlDeclared)).toMatch(/SVG is not accepted/);
  });

  it('rejects bytes that are not an image at all', () => {
    expect(assetUploadProblem(100, new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toMatch(/unrecognised image data/);
  });

  it('judges the bytes, so a label cannot make an SVG acceptable nor a WebP unacceptable', () => {
    expect(assetUploadProblem(100, svg)).not.toBeNull();
    expect(assetUploadProblem(100, HEADERS['image/webp']!)).toBeNull();
  });
});
