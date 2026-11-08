import { describe, it, expect } from 'vitest';
import { placeBelowOrAbove } from './placement.js';

const anchor = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
const view = { top: 0, bottom: 800 };

describe('placeBelowOrAbove', () => {
  it('opens below when there is room', () => {
    expect(placeBelowOrAbove(anchor(100, 130), view, 220)).toEqual({ above: false, maxHeight: 220 });
  });

  it('opens above when the room below is short and above is larger', () => {
    expect(placeBelowOrAbove(anchor(700, 730), view, 220)).toEqual({ above: true, maxHeight: 220 });
  });

  it('stays below and shrinks when above is smaller still', () => {
    expect(placeBelowOrAbove(anchor(80, 700), { top: 0, bottom: 860 }, 220)).toEqual({ above: false, maxHeight: 152 });
  });

  it('respects a clipping container, not only the viewport', () => {
    expect(placeBelowOrAbove(anchor(400, 430), { top: 300, bottom: 500 }, 220).above).toBe(true);
  });
});
