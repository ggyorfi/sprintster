import { describe, it, expect } from 'vitest';
import { InMemoryEventStore, fixtureConfig, fixtureRefConfig, loadConfig } from '@sprintster/engine';
import { buildApis, startDaemon } from './runtime.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const MEMO = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

function apisFor() {
  const apis = buildApis(fixtureRefConfig, new InMemoryEventStore());
  const client = apis.find((a) => a.obj.name === 'client')!.api;
  const memo = apis.find((a) => a.obj.name === 'memo')!.api;
  return { client, memo };
}

describe('buildApis: per-object apis with a shared ref registry', () => {
  it('accepts a memo whose client exists', async () => {
    const { client, memo } = apisFor();
    await client.add!({
      id: CLIENT,
      name: 'X',
      service: 'student',
      rate: '5000',
      paymentTermsDays: 7,
      address: null,
      notes: null,
    });
    await memo.add!({ id: MEMO, client: CLIENT, text: 'hi' });
    expect((await memo.get(MEMO))?.id).toBe(MEMO);
  });

  it('rejects a memo whose client does not exist', async () => {
    const { memo } = apisFor();
    await expect(memo.add!({ id: MEMO, client: UNKNOWN, text: 'x' })).rejects.toThrow();
  });
});

describe('startDaemon', () => {
  it('serves /health and closes cleanly', async () => {
    const daemon = await startDaemon({
      config: fixtureConfig,
      store: new InMemoryEventStore(),
      host: '127.0.0.1',
      port: 3971,
    });
    try {
      const res = await fetch('http://127.0.0.1:3971/health');
      expect(res.status).toBe(200);
    } finally {
      await daemon.close();
    }
  });

  it('rejects with a friendly message when the port is already in use', async () => {
    const first = await startDaemon({
      config: fixtureConfig,
      store: new InMemoryEventStore(),
      host: '127.0.0.1',
      port: 3972,
    });
    try {
      await expect(
        startDaemon({
          config: fixtureConfig,
          store: new InMemoryEventStore(),
          host: '127.0.0.1',
          port: 3972,
        }),
      ).rejects.toThrow(/already in use/);
    } finally {
      await first.close();
    }
  });
});

// Regression: singleton objects used to throw in createObjectApi via lifecycleInfo,
// so a daemon with one in its config could not start at all.
describe('singleton objects at startup', () => {
  const config = loadConfig({
    version: '1',
    objects: [
      {
        name: 'settings',
        title: 'Site Setting',
        titlePlural: 'Site Settings',
        route: 'site-settings',
        singleton: true,
        properties: [
          { name: 'id', type: 'id', strategy: 'uuid', system: true },
          { name: 'siteTitle', type: 'text', default: 'My site' },
          { name: 'baseUrl', type: 'text' },
        ],
        lists: [],
        views: [
          { name: 'default', title: 'Settings', fields: [{ property: 'siteTitle' }, { property: 'baseUrl' }] },
        ],
      },
    ],
  });

  it('buildApis constructs an api for a singleton', () => {
    expect(() => buildApis(config, new InMemoryEventStore())).not.toThrow();
  });

  it('the daemon starts and serves the singleton as an object', async () => {
    const daemon = await startDaemon({
      config,
      store: new InMemoryEventStore(),
      host: '127.0.0.1',
      port: 3974,
    });
    try {
      const res = await fetch('http://127.0.0.1:3974/site-settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(false);
      expect(body).toMatchObject({ siteTitle: 'My site', baseUrl: '' });
    } finally {
      await daemon.close();
    }
  });
});
