import type { KeepStore } from '@sprintster/engine';
import type { DurableObjectSqlStorage } from './event-store.js';

// A row holds at most 2 MB; 400k UTF-16 units stay under it even at 3 bytes each in UTF-8.
const PART = 400_000;

// ADR 28: plugin text in the object's own SQLite, split across rows, so reading it back costs a few rows.
export function createDurableObjectKeep(storage: DurableObjectSqlStorage): KeepStore {
  const { sql } = storage;
  sql.exec(`CREATE TABLE IF NOT EXISTS plugin_keep (key TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (key, part))`);
  return {
    async get(key) {
      const parts = sql.exec<{ value: string }>(`SELECT value FROM plugin_keep WHERE key = ? ORDER BY part`, key).toArray();
      return parts.length === 0 ? null : parts.map((p) => p.value).join('');
    },
    async put(key, value) {
      storage.transactionSync(() => {
        sql.exec(`DELETE FROM plugin_keep WHERE key = ?`, key);
        for (let i = 0; i * PART < value.length; i++) sql.exec(`INSERT INTO plugin_keep (key, part, value) VALUES (?, ?, ?)`, key, i, value.slice(i * PART, (i + 1) * PART));
      });
    },
  };
}
