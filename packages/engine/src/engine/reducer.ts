import type { Reducer } from '../entity-api/factory.js';
import type { ObjectConfig } from '../config/schema.js';
import { eventTypeNames, objectIdKey } from '../events/names.js';
import { commandEventInfos, lifecycleInfo } from './lifecycle.js';

export function makeReducer<State extends { id: string }>(obj: ObjectConfig): Reducer<State> {
  const names = eventTypeNames(obj.name);
  const idKey = objectIdKey(obj.name);
  const { field: lifecycleField, initial: lifecycleInitial } = lifecycleInfo(obj);
  // event type -> the destination status value (for statusField transition events).
  const transitionByEvent = new Map(
    commandEventInfos(obj).map((ce) => [ce.eventType, ce.command.transition.to] as const),
  );

  return (state, event) => {
    const p = event.payload as Record<string, unknown>;
    if (event.eventType === names.added) {
      if (state !== null) return state;
      const { [idKey]: _idKey, ...data } = p;
      void _idKey;
      return { ...data, id: event.streamId, [lifecycleField]: lifecycleInitial } as unknown as State;
    }
    if (event.eventType === names.fieldChanged) {
      return state === null ? null : ({ ...state, [p['field'] as string]: p['value'] } as State);
    }
    if (event.eventType === names.removed) {
      return state === null ? null : ({ ...state, [lifecycleField]: true } as State);
    }
    const toState = transitionByEvent.get(event.eventType);
    if (toState !== undefined) {
      return state === null ? null : ({ ...state, [lifecycleField]: toState } as State);
    }
    return state;
  };
}
