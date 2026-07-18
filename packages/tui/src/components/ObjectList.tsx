import React from 'react';
import { Box, Text } from 'ink';
import { formatCell, listColumns } from '@sprintster/engine';
import { THEME } from '../theme.js';

const CAP_LEFT = '\u{E0B6}';
const CAP_RIGHT = '\u{E0B4}';

type ColumnSpec = ReturnType<typeof listColumns>[number];

export interface ObjectListProps {
  rows: ReadonlyArray<Record<string, unknown>>;
  columns: ReadonlyArray<ColumnSpec>;
  idField: string;
  selectedIndex: number;
  width: number;
  scrollTop: number;
  capacity: number;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + '…';
  return s + ' '.repeat(n - s.length);
}

export function ObjectList({ rows, columns, idField, selectedIndex, width, scrollTop, capacity }: ObjectListProps): React.JSX.Element {
  const selBodyWidth = Math.max(0, width - 2);
  const maxTop = Math.max(0, rows.length - capacity);
  const start = Math.max(0, Math.min(scrollTop, maxTop));
  const visible = rows.slice(start, start + capacity);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <Text bold color={THEME.accentColor}>
          {' '}{columns.map((col) => pad(col.label, col.width)).join('')}
        </Text>
      </Box>
      <Box>
        <Text color={THEME.accentColor}>{'─'.repeat(Math.max(0, width))}</Text>
      </Box>
      {visible.map((row, li) => {
        const i = start + li;
        const isSel = i === selectedIndex;
        const key = String(row[idField]);
        const cells = columns.map((col) => ({
          text: pad(formatCell(col.property, row[col.key], col.suffix), col.width),
          dim: col.property.type === 'id',
        }));
        const rowText = cells.map((cell) => cell.text).join('');
        if (isSel) {
          const filler = Math.max(0, selBodyWidth - rowText.length);
          return (
            <Box key={key}>
              <Box width={1}>
                <Text color={THEME.selectedBgColor}>{CAP_LEFT}</Text>
              </Box>
              <Text backgroundColor={THEME.selectedBgColor} color={THEME.selectedTextColor} bold>
                {rowText}{' '.repeat(filler)}
              </Text>
              <Box width={1}>
                <Text color={THEME.selectedBgColor}>{CAP_RIGHT}</Text>
              </Box>
            </Box>
          );
        }
        return (
          <Box key={key}>
            <Text>{' '}</Text>
            {cells.map((cell, ci) =>
              cell.dim ? (
                <Text key={ci} dimColor>{cell.text}</Text>
              ) : (
                <Text key={ci} color={THEME.textColor}>{cell.text}</Text>
              ),
            )}
          </Box>
        );
      })}
    </Box>
  );
}
