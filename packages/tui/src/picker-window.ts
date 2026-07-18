export interface PickerWindow {
  indices: number[];
  windowSel: number;
}

export function pickerWindow(total: number, selected: number, radius = 7): PickerWindow {
  if (total <= 0) return { indices: [], windowSel: 0 };
  const sel = ((selected % total) + total) % total;
  const windowSize = 2 * radius + 1;
  if (total <= windowSize) {
    return { indices: Array.from({ length: total }, (_, i) => i), windowSel: sel };
  }
  const start = (((sel - radius) % total) + total) % total;
  const indices = Array.from({ length: windowSize }, (_, i) => (start + i) % total);
  return { indices, windowSel: radius };
}
