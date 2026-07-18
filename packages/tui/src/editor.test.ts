import { describe, it, expect } from 'vitest';
import {
  wrapLines,
  displayHeight,
  cursorRowCol,
  displayCursor,
  insert,
  backspace,
  move,
  stepSelection,
  type EditState,
} from './editor.js';

describe('wrapLines', () => {
  it('returns one empty line for an empty value', () => {
    expect(wrapLines('', 10)).toEqual([{ text: '', start: 0 }]);
  });

  it('breaks on explicit newlines, dropping the newline char', () => {
    expect(wrapLines('ab\ncd', 10)).toEqual([
      { text: 'ab', start: 0 },
      { text: 'cd', start: 3 },
    ]);
  });

  it('soft-wraps a long line at the width without consuming a char', () => {
    expect(wrapLines('abcdef', 3)).toEqual([
      { text: 'abc', start: 0 },
      { text: 'def', start: 3 },
    ]);
  });

  it('breaks at a space rather than mid-word, dropping the wrap space', () => {
    expect(wrapLines('hello world foo', 5)).toEqual([
      { text: 'hello', start: 0 },
      { text: 'world', start: 6 },
      { text: 'foo', start: 12 },
    ]);
  });

  it('falls back to a hard break when a word is longer than the width', () => {
    expect(wrapLines('abcdefgh ij', 3)).toEqual([
      { text: 'abc', start: 0 },
      { text: 'def', start: 3 },
      { text: 'gh', start: 6 },
      { text: 'ij', start: 9 },
    ]);
  });
});

describe('displayHeight', () => {
  it('is at least minRows', () => {
    expect(displayHeight('', 10, 3)).toBe(3);
  });
  it('grows past minRows as content wraps', () => {
    expect(displayHeight('abcdefghij', 3, 1)).toBe(4);
  });
});

describe('cursorRowCol', () => {
  it('locates the cursor across wrapped lines', () => {
    expect(cursorRowCol('abcdef', 0, 3)).toEqual({ row: 0, col: 0 });
    expect(cursorRowCol('abcdef', 4, 3)).toEqual({ row: 1, col: 1 });
    expect(cursorRowCol('abcdef', 6, 3)).toEqual({ row: 1, col: 3 });
  });
});

describe('displayCursor', () => {
  it('wraps the cursor onto a phantom next row when it fills the last line', () => {
    expect(displayCursor('abc', 3, 3)).toEqual({ row: 1, col: 0 });
  });
  it('leaves a mid-buffer cursor where cursorRowCol puts it', () => {
    expect(displayCursor('abcdef', 4, 3)).toEqual({ row: 1, col: 1 });
  });
  it('does not wrap at a soft-wrap boundary that has a continuation', () => {
    expect(displayCursor('abcdef', 3, 3)).toEqual({ row: 1, col: 0 });
  });
});

describe('edits', () => {
  it('inserts text at the cursor and advances it', () => {
    const s: EditState = { value: 'ac', cursor: 1 };
    expect(insert(s, 'b')).toEqual({ value: 'abc', cursor: 2 });
  });
  it('inserts a newline', () => {
    expect(insert({ value: 'ab', cursor: 2 }, '\n')).toEqual({ value: 'ab\n', cursor: 3 });
  });
  it('backspaces the char before the cursor', () => {
    expect(backspace({ value: 'abc', cursor: 2 })).toEqual({ value: 'ac', cursor: 1 });
  });
  it('backspace at the start is a no-op', () => {
    const s: EditState = { value: 'abc', cursor: 0 };
    expect(backspace(s)).toBe(s);
  });
});

describe('move', () => {
  const s: EditState = { value: 'abcdef', cursor: 4 };
  it('moves left and right within bounds', () => {
    expect(move(s, 'left', 3).cursor).toBe(3);
    expect(move({ value: 'ab', cursor: 2 }, 'right', 3).cursor).toBe(2);
  });
  it('moves up and down a wrapped column, keeping the column', () => {
    expect(move(s, 'up', 3).cursor).toBe(1);
    expect(move({ value: 'abcdef', cursor: 1 }, 'down', 3).cursor).toBe(4);
  });
  it('home and end snap to the wrapped line edges', () => {
    expect(move(s, 'home', 3).cursor).toBe(3);
    expect(move(s, 'end', 3).cursor).toBe(6);
  });
  it('up on the first row is a no-op', () => {
    const top: EditState = { value: 'abcdef', cursor: 1 };
    expect(move(top, 'up', 3)).toBe(top);
  });
});

describe('stepSelection', () => {
  it('wraps around both ends', () => {
    expect(stepSelection(0, 3, -1)).toBe(2);
    expect(stepSelection(2, 3, 1)).toBe(0);
    expect(stepSelection(1, 3, 1)).toBe(2);
  });
  it('is safe on an empty set', () => {
    expect(stepSelection(0, 0, 1)).toBe(0);
  });
});
