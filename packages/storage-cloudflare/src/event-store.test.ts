import * as vitest from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { describeEventStore, describeStateQuery, describeStateStore } from '@sprintster/engine/testing';
import type { EventStore, StateStore } from '@sprintster/engine';
import { createDurableObjectEventStore, type DurableObjectSqlStorage } from './event-store.js';

type Store = EventStore & { states: StateStore };

// Each call runs inside a fresh object's own context, the only place its storage may be touched.
function fresh(): Store {
  const stub = env.STORE.get(env.STORE.newUniqueId());
  const inObject = <T>(fn: (store: Store) => Promise<T>): Promise<T> =>
    runInDurableObject(stub, (_instance, state) =>
      fn(createDurableObjectEventStore(state.storage as unknown as DurableObjectSqlStorage)),
    );
  return {
    append: (input) => inObject((s) => s.append(input)),
    findByStream: (...args) => inObject((s) => s.findByStream(...args)),
    findByStreamType: (...args) => inObject((s) => s.findByStreamType(...args)),
    streamHead: (...args) => inObject((s) => s.streamHead(...args)),
    position: () => inObject((s) => s.position()),
    findSince: (...args) => inObject((s) => s.findSince(...args)),
    rewriteStreams: (...args) => inObject((s) => s.rewriteStreams(...args)),
    states: {
      appendWithState: (input, project, searchOf) => inObject((s) => s.states.appendWithState(input, project, searchOf)),
      getState: (...args) => inObject((s) => s.states.getState(...args)),
      listStates: (...args) => inObject((s) => s.states.listStates(...args)),
      statesStale: (...args) => inObject((s) => s.states.statesStale(...args)),
      replaceStates: (...args) => inObject((s) => s.states.replaceStates(...args)),
      query: (q) => inObject((s) => s.states.query(q)),
      pins: {
        pin: (...args) => inObject((s) => s.states.pins.pin(...args)),
        unpin: (...args) => inObject((s) => s.states.pins.unpin(...args)),
        query: (...args) => inObject((s) => s.states.pins.query(...args)),
        since: (...args) => inObject((s) => s.states.pins.since(...args)),
        pinsOf: (...args) => inObject((s) => s.states.pins.pinsOf(...args)),
      },
    },
  };
}

describeEventStore(vitest, 'durable object', fresh);
describeStateStore(vitest, 'durable object', fresh);
describeStateQuery(vitest, 'durable object', fresh);
