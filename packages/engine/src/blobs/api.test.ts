import { describe, it, expect } from 'vitest';
import { createBlobApi } from './api.js';
import { InMemoryBlobStore } from './store.js';
import { InMemoryEventStore } from '../events/store.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function build(actor = 'ada') {
  const events = new InMemoryEventStore();
  const blobs = new InMemoryBlobStore();
  const api = createBlobApi(events, blobs, { actor });
  return { events, blobs, api };
}

describe('createBlobApi', () => {
  it('upload stores the bytes and appends one BlobUploaded fact', async () => {
    const { events, api } = build();
    const ref = await api.upload(enc('hello'), 'image/png');
    expect(ref.size).toBe(5);
    const rows = await events.findByStream(0, '__blob', ref.hash);
    expect(rows.length).toBe(1);
    expect(rows[0]?.eventType).toBe('BlobUploaded');
    expect(rows[0]?.streamVersion).toBe(1);
    expect(rows[0]?.payload).toEqual({ hash: ref.hash, size: 5, contentType: 'image/png' });
    expect(rows[0]?.actor).toBe('ada');
  });

  it('is idempotent: re-uploading identical bytes records exactly one event', async () => {
    const { events, api } = build();
    const a = await api.upload(enc('hello'), 'image/png');
    const b = await api.upload(enc('hello'), 'image/png');
    expect(a.hash).toBe(b.hash);
    expect((await events.findByStream(0, '__blob', a.hash)).length).toBe(1);
  });

  it('records a separate fact per distinct blob', async () => {
    const { events, api } = build();
    await api.upload(enc('a'));
    await api.upload(enc('b'));
    expect((await events.findByStreamType(0, '__blob')).length).toBe(2);
  });

  it('get and has delegate to the blob store', async () => {
    const { api } = build();
    const { hash } = await api.upload(enc('hello'), 'text/plain');
    const got = await api.get(hash);
    expect(new TextDecoder().decode(got!.bytes)).toBe('hello');
    expect(got!.contentType).toBe('text/plain');
    expect(await api.has(hash)).toBe(true);
    expect(await api.has('nope')).toBe(false);
  });

  it('defaults an omitted content type to null on the event and the blob', async () => {
    const { events, api } = build();
    const { hash } = await api.upload(enc('x'));
    expect((await events.findByStream(0, '__blob', hash))[0]?.payload).toMatchObject({ contentType: null });
  });

  it('respects a non-zero partition', async () => {
    const events = new InMemoryEventStore();
    const blobs = new InMemoryBlobStore();
    const api = createBlobApi(events, blobs, { partitionId: 7 });
    const { hash } = await api.upload(enc('x'));
    expect((await events.findByStream(0, '__blob', hash)).length).toBe(0);
    expect((await events.findByStream(7, '__blob', hash)).length).toBe(1);
  });

  it('uses a per-call actor override', async () => {
    const { events, api } = build();
    const { hash } = await api.upload(enc('x'), null, 'someone');
    expect((await events.findByStream(0, '__blob', hash))[0]?.actor).toBe('someone');
  });
});
