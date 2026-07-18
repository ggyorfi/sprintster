import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

// jsdom has no layout engine; ProseMirror/TipTap call getClientRects during scrollIntoView, so stub the rect APIs to keep editor tests from throwing.
const EMPTY_RECTS = Object.assign([] as unknown[], { item: () => null }) as unknown as DOMRectList;
const EMPTY_RECT = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) } as DOMRect;
function stubRects(proto: object): void {
  const p = proto as { getClientRects?: () => DOMRectList; getBoundingClientRect?: () => DOMRect };
  if (typeof p.getClientRects !== 'function') p.getClientRects = () => EMPTY_RECTS;
  if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = () => EMPTY_RECT;
}
stubRects(Range.prototype);
stubRects(Element.prototype);
