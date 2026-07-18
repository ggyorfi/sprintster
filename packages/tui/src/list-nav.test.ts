import { describe, it, expect } from 'vitest';
import { adjustScrollTop, listNavTarget, type NavKey } from './list-nav.js';

function keys(over: Partial<NavKey> = {}): NavKey {
  return {
    upArrow: false,
    downArrow: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    ctrl: false,
    ...over,
  };
}

const CAP = 10;

describe('listNavTarget', () => {
  it('moves down on "j" and the down arrow', () => {
    expect(listNavTarget('j', keys(), 0, 50, CAP)).toBe(1);
    expect(listNavTarget('', keys({ downArrow: true }), 0, 50, CAP)).toBe(1);
  });

  it('moves up on "k" and the up arrow', () => {
    expect(listNavTarget('k', keys(), 5, 50, CAP)).toBe(4);
    expect(listNavTarget('', keys({ upArrow: true }), 5, 50, CAP)).toBe(4);
  });

  it('pages down on PgDn and Ctrl-f by capacity - 1', () => {
    expect(listNavTarget('', keys({ pageDown: true }), 0, 50, CAP)).toBe(9);
    expect(listNavTarget('f', keys({ ctrl: true }), 0, 50, CAP)).toBe(9);
  });

  it('pages up on PgUp and Ctrl-b', () => {
    expect(listNavTarget('', keys({ pageUp: true }), 20, 50, CAP)).toBe(11);
    expect(listNavTarget('b', keys({ ctrl: true }), 20, 50, CAP)).toBe(11);
  });

  it('jumps to the top on Home and "g"', () => {
    expect(listNavTarget('', keys({ home: true }), 30, 50, CAP)).toBe(0);
    expect(listNavTarget('g', keys(), 30, 50, CAP)).toBe(0);
  });

  it('jumps to the bottom on End and "G"', () => {
    expect(listNavTarget('', keys({ end: true }), 0, 50, CAP)).toBe(49);
    expect(listNavTarget('G', keys(), 0, 50, CAP)).toBe(49);
  });

  it('clamps at both ends', () => {
    expect(listNavTarget('k', keys(), 0, 50, CAP)).toBe(0);
    expect(listNavTarget('j', keys(), 49, 50, CAP)).toBe(49);
    expect(listNavTarget('', keys({ pageUp: true }), 3, 50, CAP)).toBe(0);
    expect(listNavTarget('', keys({ pageDown: true }), 47, 50, CAP)).toBe(49);
  });

  it('returns null for non-navigation keys and empty lists', () => {
    expect(listNavTarget('n', keys(), 0, 50, CAP)).toBeNull();
    expect(listNavTarget('j', keys(), 0, 0, CAP)).toBeNull();
  });
});

describe('adjustScrollTop', () => {
  it('does not scroll when everything fits', () => {
    expect(adjustScrollTop(0, 7, 10, 8, 2)).toBe(0);
  });

  it('keeps the selection within the scroll-off margin at the top edge', () => {
    // selection moving up into the margin pulls the window up
    expect(adjustScrollTop(10, 11, 10, 50, 2)).toBe(9);
  });

  it('keeps the selection within the scroll-off margin at the bottom edge', () => {
    // window top 0, capacity 10 -> last visible 9; selecting 8 with margin 2 scrolls down
    expect(adjustScrollTop(0, 8, 10, 50, 2)).toBe(1);
  });

  it('does not move when the selection is comfortably inside the window', () => {
    expect(adjustScrollTop(5, 9, 10, 50, 2)).toBe(5);
  });

  it('clamps to the last full page at the bottom', () => {
    expect(adjustScrollTop(0, 49, 10, 50, 2)).toBe(40);
  });

  it('clamps to zero at the top', () => {
    expect(adjustScrollTop(40, 0, 10, 50, 2)).toBe(0);
  });

  it('caps the margin so it never exceeds half the window', () => {
    // huge scrollOff with small capacity should still produce a valid window
    const top = adjustScrollTop(0, 25, 4, 50, 100);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(46);
  });
});
