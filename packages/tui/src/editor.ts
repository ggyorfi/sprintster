export interface EditState {
  value: string;
  cursor: number;
}

export interface DisplayLine {
  text: string;
  start: number;
}

export type MoveDir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function wrapLines(value: string, width: number): DisplayLine[] {
  const w = Math.max(1, width);
  const lines: DisplayLine[] = [];
  let segStart = 0;
  for (let i = 0; i <= value.length; i++) {
    if (i === value.length || value[i] === '\n') {
      wrapSegment(lines, value.slice(segStart, i), segStart, w);
      segStart = i + 1;
    }
  }
  return lines;
}

function wrapSegment(out: DisplayLine[], text: string, base: number, w: number): void {
  let lineStart = 0;
  do {
    if (text.length - lineStart <= w) {
      out.push({ text: text.slice(lineStart), start: base + lineStart });
      return;
    }
    const hardEnd = lineStart + w;
    let space = -1;
    for (let j = hardEnd; j > lineStart; j--) {
      if (text[j] === ' ') {
        space = j;
        break;
      }
    }
    if (space === -1) {
      out.push({ text: text.slice(lineStart, hardEnd), start: base + lineStart });
      lineStart = hardEnd;
    } else {
      out.push({ text: text.slice(lineStart, space), start: base + lineStart });
      lineStart = space + 1;
    }
  } while (lineStart < text.length);
}

export function displayHeight(value: string, width: number, minRows: number): number {
  return Math.max(Math.max(1, minRows), wrapLines(value, width).length);
}

export function cursorRowCol(value: string, cursor: number, width: number): { row: number; col: number } {
  const lines = wrapLines(value, width);
  const c = clamp(cursor, 0, value.length);
  let row = 0;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]?.start ?? 0;
    if (start <= c) row = i;
    else break;
  }
  return { row, col: c - (lines[row]?.start ?? 0) };
}

export function displayCursor(value: string, cursor: number, width: number): { row: number; col: number } {
  const w = Math.max(1, width);
  const lines = wrapLines(value, w);
  const { row, col } = cursorRowCol(value, cursor, w);
  if (col >= w && row === lines.length - 1) return { row: row + 1, col: 0 };
  return { row, col };
}

function rowColToOffset(lines: DisplayLine[], row: number, col: number): number {
  const r = clamp(row, 0, lines.length - 1);
  const line = lines[r];
  if (line === undefined) return 0;
  return line.start + clamp(col, 0, line.text.length);
}

export function insert(state: EditState, text: string): EditState {
  const c = clamp(state.cursor, 0, state.value.length);
  return { value: state.value.slice(0, c) + text + state.value.slice(c), cursor: c + text.length };
}

export function backspace(state: EditState): EditState {
  const c = clamp(state.cursor, 0, state.value.length);
  if (c === 0) return state;
  return { value: state.value.slice(0, c - 1) + state.value.slice(c), cursor: c - 1 };
}

export function move(state: EditState, dir: MoveDir, width: number): EditState {
  const len = state.value.length;
  const c = clamp(state.cursor, 0, len);
  if (dir === 'left') return { ...state, cursor: Math.max(0, c - 1) };
  if (dir === 'right') return { ...state, cursor: Math.min(len, c + 1) };
  const lines = wrapLines(state.value, width);
  const { row, col } = cursorRowCol(state.value, c, width);
  if (dir === 'home') return { ...state, cursor: rowColToOffset(lines, row, 0) };
  if (dir === 'end') return { ...state, cursor: rowColToOffset(lines, row, lines[row]?.text.length ?? 0) };
  const targetRow = dir === 'up' ? row - 1 : row + 1;
  if (targetRow < 0 || targetRow >= lines.length) return state;
  return { ...state, cursor: rowColToOffset(lines, targetRow, col) };
}

export function stepSelection(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (index + delta + length) % length;
}
