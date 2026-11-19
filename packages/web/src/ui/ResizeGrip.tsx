import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import styles from './ResizeGrip.module.css';

const MIN_HEIGHT = 66;
const KEY_STEP = 24;

// Controlled when `onChange` is given (a combo shares one height between its editors), else the editor keeps its own.
export function useEditorHeight(height: number | undefined, onChange: ((height: number) => void) | undefined) {
  const [own, setOwn] = useState<number | undefined>(undefined);
  return onChange === undefined ? ([own, setOwn] as const) : ([height, onChange] as const);
}

export function heightStyle(height: number | undefined) {
  return height === undefined ? undefined : ({ '--editor-height': `${height}px` } as CSSProperties);
}

export function ResizeGrip({ target, onResize }: { target: () => Element | null | undefined; onResize: (height: number) => void }) {
  const start = useRef<{ y: number; height: number } | null>(null);
  const current = () => target()?.getBoundingClientRect().height || MIN_HEIGHT;
  const resize = (height: number) => onResize(Math.max(MIN_HEIGHT, Math.round(height)));
  const end = (e: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize editor"
      tabIndex={0}
      className={styles.grip}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = { y: e.clientY, height: current() };
      }}
      onPointerMove={(e) => {
        if (start.current !== null) resize(start.current.height + e.clientY - start.current.y);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        resize(current() + (e.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP));
      }}
    >
      <span className={styles.handle} />
    </div>
  );
}
