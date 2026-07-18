import type { ReactNode } from 'react';
import styles from './Pill.module.css';

export type PillTone = 'neutral' | 'info' | 'success' | 'danger' | 'muted';

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
}

export function Pill({ children, tone = 'neutral' }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone]].join(' ')} data-tone={tone}>
      {children}
    </span>
  );
}
