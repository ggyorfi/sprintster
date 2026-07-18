import { describe, it, expect } from 'vitest';
import { pickerWindow } from './picker-window.js';

describe('pickerWindow short list (total <= 2*radius+1)', () => {
  it('shows the whole list at the selected position, no wrap', () => {
    expect(pickerWindow(3, 1, 7)).toEqual({ indices: [0, 1, 2], windowSel: 1 });
    expect(pickerWindow(15, 7, 7)).toEqual({
      indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      windowSel: 7,
    });
  });
});

describe('pickerWindow long list (total > 2*radius+1)', () => {
  it('always centres the selected at windowSel = radius (the caller positions the overlay to pin it on the field row)', () => {
    expect(pickerWindow(100, 0, 7).windowSel).toBe(7);
    expect(pickerWindow(100, 50, 7).windowSel).toBe(7);
    expect(pickerWindow(100, 99, 7).windowSel).toBe(7);
  });

  it('centres 15 items on the selected in the deep middle', () => {
    const w = pickerWindow(100, 50, 7);
    expect(w.indices).toHaveLength(15);
    expect(w.indices).toEqual([43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57]);
    expect(w.indices[w.windowSel]).toBe(50);
  });

  it('wraps from the end of the list when the selected is near the start (endless wheel)', () => {
    const w = pickerWindow(100, 0, 7);
    expect(w.indices).toEqual([93, 94, 95, 96, 97, 98, 99, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(w.indices[w.windowSel]).toBe(0);
  });

  it('wraps to the start of the list when the selected is near the end', () => {
    const w = pickerWindow(100, 99, 7);
    expect(w.indices).toEqual([92, 93, 94, 95, 96, 97, 98, 99, 0, 1, 2, 3, 4, 5, 6]);
    expect(w.indices[w.windowSel]).toBe(99);
  });

  it('crosses the cyclic boundary cleanly on consecutive steps', () => {
    const a = pickerWindow(100, 99, 7);
    const b = pickerWindow(100, 0, 7);
    expect(a.indices[7]).toBe(99);
    expect(a.indices[8]).toBe(0);
    expect(b.indices[7]).toBe(0);
    expect(b.indices[6]).toBe(99);
  });

  it('treats a negative or overflowing selected with modular reduction', () => {
    expect(pickerWindow(100, -1, 7).indices[7]).toBe(99);
    expect(pickerWindow(100, 100, 7).indices[7]).toBe(0);
  });
});

describe('pickerWindow edge cases', () => {
  it('returns an empty window for an empty list', () => {
    expect(pickerWindow(0, 0, 7)).toEqual({ indices: [], windowSel: 0 });
  });
});
