import { describe, it, expect } from 'vitest';
import { InMemoryEventStore, fixtureRefConfig } from '@sprintster/engine';
import { buildApis } from './runtime.js';

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
