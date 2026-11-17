import { useLive } from './live.js';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  version: string;
}

export function StatusBar({ version }: StatusBarProps) {
  const ok = useLive().connected;

  const label = ok === null ? 'connecting...' : ok ? 'Backend connected' : 'Backend unreachable';
  const dotClass = [styles.dot, ok === true ? styles.good : ok === false ? styles.bad : ''].filter(Boolean).join(' ');

  return (
    <div className={styles.bar}>
      <span className={dotClass} />
      <span>{label}</span>
      <span className={styles.spacer} />
      <span className={styles.muted}>v{version}</span>
    </div>
  );
}
