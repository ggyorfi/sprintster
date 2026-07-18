export interface NavKey {
  upArrow: boolean;
  downArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home: boolean;
  end: boolean;
  ctrl: boolean;
}

export function listNavTarget(
  input: string,
  key: NavKey,
  current: number,
  count: number,
  capacity: number,
): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const page = Math.max(1, capacity - 1);
  const clamp = (n: number): number => Math.max(0, Math.min(last, n));

  if (key.upArrow || input === 'k') return clamp(current - 1);
  if (key.downArrow || input === 'j') return clamp(current + 1);
  if (key.pageUp || (key.ctrl && input === 'b')) return clamp(current - page);
  if (key.pageDown || (key.ctrl && input === 'f')) return clamp(current + page);
  if (key.home || input === 'g') return 0;
  if (key.end || input === 'G') return last;
  return null;
}

export function adjustScrollTop(
  prevTop: number,
  selected: number,
  capacity: number,
  total: number,
  scrollOff: number,
): number {
  if (total <= capacity) return 0;
  const maxTop = total - capacity;
  const margin = Math.max(0, Math.min(scrollOff, Math.floor((capacity - 1) / 2)));
  let top = prevTop;
  if (selected < top + margin) top = selected - margin;
  else if (selected > top + capacity - 1 - margin) top = selected - (capacity - 1 - margin);
  return Math.max(0, Math.min(maxTop, top));
}
