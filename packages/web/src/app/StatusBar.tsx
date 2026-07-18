import { useEffect, useState } from 'react';
import { fetchHealth } from './health.js';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  baseUrl: string;
  version: string;
}

export function StatusBar({ baseUrl, version }: StatusBarProps) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetchHealth(baseUrl)
        .then(() => alive && setOk(true))
        .catch(() => alive && setOk(false));
    void ping();
    const timer = setInterval(() => void ping(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [baseUrl]);

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
