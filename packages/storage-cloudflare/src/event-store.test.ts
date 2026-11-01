import * as vitest from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { describeEventStore, describeStateStore } from '@sprintster/engine/testing';
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
    states: {
      appendWithState: (input, project) => inObject((s) => s.states.appendWithState(input, project)),
      getState: (...args) => inObject((s) => s.states.getState(...args)),
      listStates: (...args) => inObject((s) => s.states.listStates(...args)),
      statesStale: (...args) => inObject((s) => s.states.statesStale(...args)),
      replaceStates: (...args) => inObject((s) => s.states.replaceStates(...args)),
    },
  };
}

describeEventStore(vitest, 'durable object', fresh);
describeStateStore(vitest, 'durable object', fresh);
