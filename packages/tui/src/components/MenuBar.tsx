import React from 'react';
import { Box, Text } from 'ink';
import { THEME } from '../theme.js';

const CAP_LEFT = '';
const CAP_RIGHT = '';

export interface MenuTitle {
  label: string;
  hotkey: string;
}

export interface MenuBarProps {
  titles: ReadonlyArray<MenuTitle>;
  activeIndex: number | null;
  width: number;
}

function chipWidth(t: MenuTitle): number {
  return 1 + t.label.length + 1 + 5 + 1;
}

export function MenuBar({ titles, activeIndex, width }: MenuBarProps): React.JSX.Element {
  const bodyWidth = Math.max(0, width - 3);
  const usedChars = 1 + titles.reduce((s, t) => s + chipWidth(t) + 1, 0);
  const remaining = Math.max(0, bodyWidth - usedChars);

  return (
    <Box>
      <Box width={1}>
        <Text color={THEME.navBgColor}>{CAP_LEFT}</Text>
      </Box>
      <Text>
        <Text backgroundColor={THEME.navBgColor} color={THEME.navTextColor}>{'  '}</Text>
        {titles.map((t, i) => {
          const active = i === activeIndex;
          const bg = active ? THEME.navSelectedBgColor : THEME.navBgColor;
          const fg = active ? THEME.navSelectedTextColor : THEME.navTextColor;
          const shortcut = `Alt+${t.hotkey.toUpperCase()}`;
          return (
            <React.Fragment key={t.label}>
              <Text backgroundColor={bg} color={fg} bold={active}>
                {' '}
                {t.label}
                {' '}
                <Text color={active ? THEME.highlightColor : THEME.navTextColor} dimColor={!active}>{shortcut}</Text>
                {' '}
              </Text>
              <Text backgroundColor={THEME.navBgColor} color={THEME.navTextColor}>{' '}</Text>
            </React.Fragment>
          );
        })}
        <Text backgroundColor={THEME.navBgColor} color={THEME.navTextColor}>{' '.repeat(remaining)}</Text>
      </Text>
      <Box width={1}>
        <Text color={THEME.navBgColor}>{CAP_RIGHT}</Text>
      </Box>
    </Box>
  );
}
