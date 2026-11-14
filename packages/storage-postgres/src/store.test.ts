import * as vitest from 'vitest';
import { afterAll, describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { describeEventStore, describeStateQuery, describeStateStore } from '@sprintster/engine/testing';
import { createPgEventStore, type EventStoreDatabase } from './store.js';

// A real Postgres, for example `pnpm test:pg` (docker postgres:17 on port 54329).
const url = process.env['SPRINTSTER_TEST_PG_URL'];
const pools: pg.Pool[] = [];
let n = 0;

// Each store gets an empty schema of its own.
async function fresh() {
  const schema = `t_${process.pid}_${n++}`;
  const admin = new pg.Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  pools.push(pool);
  return createPgEventStore(new Kysely<EventStoreDatabase>({ dialect: new PostgresDialect({ pool }) }));
}

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

if (url === undefined) {
  describe('postgres store', () => {
    it.skip('needs SPRINTSTER_TEST_PG_URL', () => {});
  });
} else {
  describeEventStore(vitest, 'postgres', fresh);
  describeStateStore(vitest, 'postgres', fresh);
  describeStateQuery(vitest, 'postgres', fresh);

  describe('postgres schema', () => {
    it('creates its tables on first use', async () => {
      const store = await fresh();
      expect(await store.position()).toBe(0);
      await store.append({ partitionId: 0, streamType: 'x', streamId: 'a', streamVersion: 1, eventType: 'XAdded', eventVersion: 1, payload: {}, occurredAt: '2026-01-01T00:00:00Z', actor: 't', correlationId: null });
      expect(await store.position()).toBe(1);
    });
  });
}
