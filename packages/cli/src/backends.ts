import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import Database from 'better-sqlite3';
import type { EventStore } from '@sprintster/engine';
import { createSqliteEventStore } from '@sprintster/storage-sqlite';
import { createPgEventStore, type EventStoreDatabase } from '@sprintster/storage-postgres';
import type { BackendConfig } from './project-config.js';

export interface OpenedBackend {
  store: EventStore;
  close(): Promise<void>;
}

export async function openBackend(backend: BackendConfig): Promise<OpenedBackend> {
  switch (backend.kind) {
    case 'sqlite': {
      if (backend.path !== ':memory:') mkdirSync(dirname(backend.path), { recursive: true });
      const db = new Database(backend.path);
      return {
        store: createSqliteEventStore(db),
        close: async () => {
          db.close();
        },
      };
    }
    case 'postgres': {
      const pool = new pg.Pool({ connectionString: backend.url });
      const db = new Kysely<EventStoreDatabase>({ dialect: new PostgresDialect({ pool }) });
      return {
        store: createPgEventStore(db),
        close: async () => {
          await db.destroy();
        },
      };
    }
  }
}
