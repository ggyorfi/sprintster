import { describe, expect, it } from 'vitest';
import { rasterSize, svgAsPng } from './svg.js';

const root = (attrs: string) => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`, 'image/svg+xml').documentElement;

describe('rasterSize', () => {
  it('scales the viewBox to the target width', () => {
    expect(rasterSize(root('viewBox="0 0 884.99998 312.23336" width="944"'))).toEqual({ width: 1920, height: 677 });
  });

  it('falls back to width and height, and refuses an SVG without a size', () => {
    expect(rasterSize(root('width="200" height="100"'), 400)).toEqual({ width: 400, height: 200 });
    expect(rasterSize(root('width="100%" height="50%"'))).toBeNull();
    expect(rasterSize(root(''))).toBeNull();
  });
});

describe('svgAsPng', () => {
  it('passes any other file through untouched', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
    expect(await svgAsPng(file)).toBe(file);
  });

  it('refuses an SVG it cannot size', async () => {
    await expect(svgAsPng(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'a.svg'))).rejects.toThrow(/no viewBox/);
  });
});
