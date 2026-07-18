import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import Database from 'better-sqlite3';
import type { BlobStore, EventStore } from '@sprintster/engine';
import { createSqliteEventStore, createSqliteBlobStore } from '@sprintster/storage-sqlite';
import {
  createPgEventStore,
  createPgBlobStore,
  type EventStoreDatabase,
  type BlobStoreDatabase,
} from '@sprintster/storage-postgres';
import type { BackendConfig } from './project-config.js';

export interface OpenedBackend {
  store: EventStore;
  blobStore: BlobStore;
  close(): Promise<void>;
}

type PgDatabase = EventStoreDatabase & BlobStoreDatabase;

export async function openBackend(backend: BackendConfig): Promise<OpenedBackend> {
  switch (backend.kind) {
    case 'sqlite': {
      if (backend.path !== ':memory:') mkdirSync(dirname(backend.path), { recursive: true });
      const db = new Database(backend.path);
      return {
        store: createSqliteEventStore(db),
        blobStore: createSqliteBlobStore(db),
        close: async () => {
          db.close();
        },
      };
    }
    case 'postgres': {
      const pool = new pg.Pool({ connectionString: backend.url });
      // One Kysely over both tables and one connection; Kysely is invariant on its schema, so narrow per factory.
      const db = new Kysely<PgDatabase>({ dialect: new PostgresDialect({ pool }) });
      return {
        store: createPgEventStore(db as unknown as Kysely<EventStoreDatabase>),
        blobStore: createPgBlobStore(db as unknown as Kysely<BlobStoreDatabase>),
        close: async () => {
          await db.destroy();
        },
      };
    }
  }
}
