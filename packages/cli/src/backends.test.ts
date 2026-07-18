import { describe, it, expect } from 'vitest';
import { openBackend } from './backends.js';

describe('openBackend', () => {
  it('opens a sqlite :memory: backend with a working store', async () => {
    const backend = await openBackend({ kind: 'sqlite', path: ':memory:' });
    const row = await backend.store.append({
      partitionId: 0,
      streamType: 't',
      streamId: 's',
      streamVersion: 1,
      eventType: 'E',
      eventVersion: 1,
      payload: { a: 1 },
      occurredAt: '2026-01-01T00:00:00.000Z',
      actor: 'test',
      correlationId: null,
    });
    expect(row.id).toBeTypeOf('string');
    expect(await backend.store.streamHead(0, 't', 's')).toBe(1);
    await backend.close();
  });
});
