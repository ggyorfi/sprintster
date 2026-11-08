import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Placement {
  above: boolean;
  maxHeight: number;
}

const GAP = 8;

// The visible area an element can draw into: the viewport, narrowed by every ancestor that clips its overflow.
function clipBounds(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'visible') continue;
    const rect = node.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

// Opens a dropdown below its anchor, or above when there is more room there than below and too little below.
export function placeBelowOrAbove(anchor: DOMRect, bounds: { top: number; bottom: number }, preferred: number): Placement {
  const below = bounds.bottom - anchor.bottom - GAP;
  const above = anchor.top - bounds.top - GAP;
  const flip = below < preferred && above > below;
  return { above: flip, maxHeight: Math.max(80, Math.min(preferred, flip ? above : below)) };
}

export function useDropdownPlacement(anchor: RefObject<HTMLElement | null>, open: boolean, preferred: number): Placement {
  const [placement, setPlacement] = useState<Placement>({ above: false, maxHeight: preferred });
  useLayoutEffect(() => {
    const el = anchor.current;
    if (!open || el === null) return;
    const update = () => setPlacement(placeBelowOrAbove(el.getBoundingClientRect(), clipBounds(el), preferred));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, open, preferred]);
  return placement;
}
