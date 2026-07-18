import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { backspace, displayCursor, insert, move, wrapLines } from '../editor.js';
import { THEME } from '../theme.js';

export interface MultilineInputProps {
  value: string;
  onChange(next: string): void;
  focus: boolean;
  width: number;
  minRows?: number;
  placeholder?: string;
}

export function MultilineInput({
  value,
  onChange,
  focus,
  width,
  minRows = 1,
  placeholder = '',
}: MultilineInputProps): React.JSX.Element {
  const [cursor, setCursor] = useState(value.length);
  const cur = Math.min(cursor, value.length);

  useEffect(() => {
    if (focus) setCursor(value.length);
  }, [focus]);

  useInput(
    (input, key) => {
      if (key.tab || key.escape || key.meta) return;
      const state = { value, cursor: cur };
      if (key.return) {
        const next = insert(state, '\n');
        onChange(next.value);
        setCursor(next.cursor);
        return;
      }
      if (key.backspace || key.delete) {
        const next = backspace(state);
        onChange(next.value);
        setCursor(next.cursor);
        return;
      }
      if (key.leftArrow) return setCursor(move(state, 'left', width).cursor);
      if (key.rightArrow) return setCursor(move(state, 'right', width).cursor);
      if (key.upArrow) return setCursor(move(state, 'up', width).cursor);
      if (key.downArrow) return setCursor(move(state, 'down', width).cursor);
      if (input !== '' && !key.ctrl) {
        const next = insert(state, input);
        onChange(next.value);
        setCursor(next.cursor);
      }
    },
    { isActive: focus },
  );

  const lines = wrapLines(value, width);
  const { row: curRow, col: curCol } = displayCursor(value, cur, width);
  const rowCount = Math.max(minRows, lines.length, focus ? curRow + 1 : 0);

  const showPlaceholder = !focus && value === '' && placeholder !== '';

  const rendered: React.ReactNode[] = [];
  for (let r = 0; r < rowCount; r++) {
    const text = lines[r]?.text ?? '';
    if (showPlaceholder && r === 0) {
      rendered.push(
        <Text key={r} dimColor>
          {pad(placeholder, width)}
        </Text>,
      );
      continue;
    }
    if (focus && r === curRow) {
      const before = text.slice(0, curCol);
      const at = text[curCol] ?? ' ';
      const after = text.slice(curCol + 1);
      const tail = pad(after, Math.max(0, width - before.length - 1));
      rendered.push(
        <Text key={r} backgroundColor={THEME.fieldBgColor} color={THEME.fieldTextColor}>
          {before}
          <Text backgroundColor={THEME.cursorBgColor} color={THEME.cursorTextColor}>
            {at}
          </Text>
          {tail}
        </Text>,
      );
      continue;
    }
    rendered.push(
      <Text key={r} backgroundColor={THEME.fieldBgColor} color={THEME.fieldTextColor}>
        {pad(text, width)}
      </Text>,
    );
  }

  return <Box flexDirection="column">{rendered}</Box>;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}
