import type { LogChange } from '../plugin/types.js';
import type { EventStore } from './store.js';

// Engine-internal streams (sequences, unique claims) start with '__' and are not changes to an object.
export async function changesSince(store: EventStore, position: number): Promise<LogChange[]> {
  return (await store.findSince(position))
    .filter((r) => !r.streamType.startsWith('__'))
    .map((r) => ({ position: Number(r.id), object: r.streamType, id: r.streamId, event: r.eventType, at: r.recordedAt }));
}
