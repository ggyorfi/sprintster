import React from 'react';
import { Box, Text, useInput } from 'ink';
import { stepSelection } from '../editor.js';
import { fuzzyFilter } from '@sprintster/engine';
import { THEME } from '../theme.js';

export interface PickerOption {
  id: string;
  label: string;
  raw?: Record<string, unknown>;
}

export interface PickerOverlayOption extends PickerOption {
  matches?: ReadonlyArray<number>;
}

export interface PickerProps {
  value: string;
  onChange(next: string): void;
  focus: boolean;
  options: ReadonlyArray<PickerOption>;
  width: number;
  placeholder?: string;
  filter?: string | undefined;
  onFilterChange?: ((next: string) => void) | undefined;
}

export function Picker({
  value,
  onChange,
  focus,
  options,
  width,
  placeholder = '',
  filter = '',
  onFilterChange,
}: PickerProps): React.JSX.Element {
  useInput(
    (input, key) => {
      if (key.tab || key.escape || key.meta) return;
      if (options.length === 0) return;
      if ((key.backspace || key.delete) && onFilterChange) {
        if (filter.length > 0) onFilterChange(filter.slice(0, -1));
        return;
      }
      const filtered = fuzzyFilter(options, filter).map((h) => h.option);
      if (key.upArrow || (key.ctrl && input === 'p')) {
        const cur = filtered.findIndex((o) => o.id === value);
        const base = cur < 0 ? 0 : cur;
        onChange(filtered[stepSelection(base, filtered.length, -1)]?.id ?? '');
        return;
      }
      if (key.downArrow || (key.ctrl && input === 'n')) {
        const cur = filtered.findIndex((o) => o.id === value);
        const base = cur < 0 ? 0 : cur;
        onChange(filtered[stepSelection(base, filtered.length, 1)]?.id ?? '');
        return;
      }
      if (input && !key.ctrl && onFilterChange) {
        const attempt = filter + input;
        const next = fuzzyFilter(options, attempt).map((h) => h.option);
        if (next.length === 0) return;
        onFilterChange(attempt);
        if (!next.some((o) => o.id === value)) {
          onChange(next[0]?.id ?? '');
        }
      }
    },
    { isActive: focus },
  );

  const current = options.find((o) => o.id === value);
  const shown = current ? current.label : placeholder;
  const color = current ? THEME.fieldTextColor : THEME.mutedColor;
  return <Text backgroundColor={THEME.fieldBgColor} color={color}>{pad(shown, width)}</Text>;
}

export interface PickerOverlayProps {
  options: ReadonlyArray<PickerOverlayOption>;
  selectedId: string;
  width: number;
}

export function PickerOverlay({ options, selectedId, width }: PickerOverlayProps): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {options.map((opt, i) => {
        const selected = opt.id === selectedId;
        const baseColor = selected ? THEME.selectedTextColor : THEME.fieldTextColor;
        const padded = pad(opt.label, width);
        const set = new Set(opt.matches ?? []);
        const chars = [...padded].map((ch, j) =>
          set.has(j) ? (
            <Text key={j} color={THEME.highlightColor} bold>
              {ch}
            </Text>
          ) : (
            ch
          ),
        );
        return selected ? (
          <Text key={`${opt.id}-${i}`} backgroundColor={THEME.selectedBgColor} color={baseColor} bold>
            {chars}
          </Text>
        ) : (
          <Text key={`${opt.id}-${i}`} color={baseColor}>
            {chars}
          </Text>
        );
      })}
    </Box>
  );
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}
