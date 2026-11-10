import type { LogChange } from '../plugin/types.js';
import type { EventRow, EventStore } from './store.js';

// Internal stream recording each erase or redaction (ADR 18): one stream per record, never its values.
export const ERASED_STREAM_TYPE = '__erased';

// Engine-internal streams (sequences, unique claims) start with '__' and are not changes to an object; an erase marker (ADR 18) reports the record it erased.
export async function changesSince(store: EventStore, position: number): Promise<LogChange[]> {
  return (await store.findSince(position)).flatMap((r: EventRow) => {
    const change = { position: Number(r.id), object: r.streamType, id: r.streamId, event: r.eventType, at: r.recordedAt };
    if (r.streamType === ERASED_STREAM_TYPE) {
      const { object, id } = r.payload as { object: string; id: string };
      return [{ ...change, object, id }];
    }
    return r.streamType.startsWith('__') ? [] : [change];
  });
}
