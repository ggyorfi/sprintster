import { ConcurrencyError } from '../errors/api-error.js';
import {
  UniqueViolationError,
  type EventInput,
  type EventRow,
  type EventStore,
} from '../events/store.js';

export type Reducer<State> = (state: State | null, event: EventRow) => State | null;

export interface EntityApiConfig<State> {
  partitionId: number;
  streamType: string;
  reducer: Reducer<State>;
  maxRetries?: number;
}

export interface ApplyEventInput {
  eventType: string;
  eventVersion: number;
  payload: unknown;
  actor: string;
  occurredAt?: string;
  correlationId?: string | null;
}

export interface EntityApi<State> {
  findOneById(streamId: string): Promise<State | null>;
  findMany(): Promise<State[]>;
  createEvent(streamId: string, build: (state: State | null) => ApplyEventInput): Promise<State>;
}

export function createEntityApi<State>(
  store: EventStore,
  config: EntityApiConfig<State>,
): EntityApi<State> {
  const { partitionId, streamType, reducer } = config;
  const maxRetries = config.maxRetries ?? 5;

  async function foldStream(streamId: string): Promise<{ state: State | null; version: number }> {
    const events = await store.findByStream(partitionId, streamType, streamId);
    let state: State | null = null;
    for (const e of events) state = reducer(state, e);
    return { state, version: events.length };
  }

  async function findOneById(streamId: string): Promise<State | null> {
    return (await foldStream(streamId)).state;
  }

  async function findMany(): Promise<State[]> {
    const events = await store.findByStreamType(partitionId, streamType);
    const byStream = new Map<string, EventRow[]>();
    for (const e of events) {
      const arr = byStream.get(e.streamId);
      if (arr === undefined) byStream.set(e.streamId, [e]);
      else arr.push(e);
    }
    const out: State[] = [];
    for (const list of byStream.values()) {
      list.sort((a, b) => a.streamVersion - b.streamVersion);
      let s: State | null = null;
      for (const e of list) s = reducer(s, e);
      if (s !== null) out.push(s);
    }
    return out;
  }

  async function createEvent(
    streamId: string,
    build: (state: State | null) => ApplyEventInput,
  ): Promise<State> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { state, version } = await foldStream(streamId);
      const built = build(state);
      const input: EventInput = {
        partitionId,
        streamType,
        streamId,
        streamVersion: version + 1,
        eventType: built.eventType,
        eventVersion: built.eventVersion,
        payload: built.payload,
        occurredAt: built.occurredAt ?? new Date().toISOString(),
        actor: built.actor,
        correlationId: built.correlationId ?? null,
      };
      try {
        const row = await store.append(input);
        const next = reducer(state, row);
        if (next === null) {
          throw new Error(
            `reducer returned null after applying ${built.eventType}; entity removed but expected a state`,
          );
        }
        return next;
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw new ConcurrencyError(
      `OCC retry limit reached for ${streamType}/${streamId} after ${maxRetries} attempts: ${String(lastErr)}`,
    );
  }

  return { findOneById, findMany, createEvent };
}
