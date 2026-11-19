import { ASSET_HEADER_BYTES, looksLikeSvg } from '@sprintster/engine';

// SVG is never stored (ADR 9); drawn through an <img> here it runs no script and loads nothing.
export const SVG_WIDTH = 1920;

function drawingSize(root: Element): { w: number; h: number } | null {
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const length = (name: string) => {
    const value = root.getAttribute(name) ?? '';
    return value.endsWith('%') ? NaN : parseFloat(value);
  };
  const w = box?.length === 4 ? (box[2] ?? NaN) : length('width');
  const h = box?.length === 4 ? (box[3] ?? NaN) : length('height');
  return w > 0 && h > 0 ? { w, h } : null;
}

export function rasterSize(root: Element, width = SVG_WIDTH): { width: number; height: number } | null {
  const drawing = drawingSize(root);
  return drawing === null ? null : { width, height: Math.max(1, Math.round((width * drawing.h) / drawing.w)) };
}

export async function svgAsPng(file: File): Promise<File> {
  if (!looksLikeSvg(new Uint8Array(await file.slice(0, ASSET_HEADER_BYTES).arrayBuffer()))) return file;
  const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const root = doc.documentElement;
  const size = root.localName === 'svg' ? rasterSize(root) : null;
  if (size === null) throw new Error('this SVG has no viewBox or size to convert it from');
  // Without a viewBox, a new width and height enlarge the canvas but not the drawing.
  const drawing = drawingSize(root);
  if (!root.hasAttribute('viewBox') && drawing !== null) root.setAttribute('viewBox', `0 0 ${drawing.w} ${drawing.h}`);
  root.setAttribute('width', String(size.width));
  root.setAttribute('height', String(size.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')?.drawImage(img, 0, 0, size.width, size.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (png === null) throw new Error('this browser could not convert the SVG');
    return new File([png], `${file.name.replace(/\.svg$/i, '')}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
