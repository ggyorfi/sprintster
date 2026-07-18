import { useEffect, useState } from 'react';
import { Button } from '../ui/index.js';
import { formatError } from '../engine/index.js';
import { fetchHealth, type Health } from './health.js';
import styles from './Maintenance.module.css';

export interface MaintenanceProps {
  baseUrl: string;
}

export function Maintenance({ baseUrl }: MaintenanceProps) {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    fetchHealth(baseUrl)
      .then((h) => {
        setHealth(h);
        setLoading(false);
      })
      .catch((e) => {
        setError(formatError(e));
        setLoading(false);
      });
  }

  useEffect(load, [baseUrl]);

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>Maintenance</h1>
        <Button variant="neutral" onClick={load}>
          Refresh
        </Button>
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Health</h2>
        {loading ? (
          <p className={styles.muted}>Checking...</p>
        ) : error !== null ? (
          <p className={styles.bad}>{error}</p>
        ) : health !== null ? (
          <dl className={styles.kv}>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Version</dt>
            <dd>{health.version}</dd>
            <dt>Time</dt>
            <dd>{health.time}</dd>
          </dl>
        ) : null}
      </div>
      <p className={styles.note}>
        Ledger checks, projection replay, and backups will appear here once the daemon exposes those endpoints.
      </p>
    </div>
  );
}
