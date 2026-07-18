import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import Database from 'better-sqlite3';
import { InMemoryBlobStore, type BlobStore, type EventStore } from '@sprintster/engine';
import { createSqliteEventStore } from '@sprintster/storage-sqlite';
import { createPgEventStore, type EventStoreDatabase } from '@sprintster/storage-postgres';
import { createFsBlobStore } from './fs-blob-store.js';
import type { BackendConfig } from './project-config.js';

export interface OpenedBackend {
  store: EventStore;
  blobStore: BlobStore;
  close(): Promise<void>;
}

// Blobs live on the filesystem (never in the DB) under the environment's configured dir: the on-ramp to an object store later.
export async function openBackend(backend: BackendConfig, blobDir: string): Promise<OpenedBackend> {
  switch (backend.kind) {
    case 'sqlite': {
      const memory = backend.path === ':memory:';
      if (!memory) mkdirSync(dirname(backend.path), { recursive: true });
      const db = new Database(backend.path);
      return {
        store: createSqliteEventStore(db),
        blobStore: memory ? new InMemoryBlobStore() : createFsBlobStore(blobDir),
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
        blobStore: createFsBlobStore(blobDir),
        close: async () => {
          await db.destroy();
        },
      };
    }
  }
}
