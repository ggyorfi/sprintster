import type { EntityApi } from '../entity-api/factory.js';

export interface PlannedEvent {
  eventType: string;
  eventVersion: number;
  payload: unknown;
}

export type FieldEventBuilder<State> = (
  id: string,
  field: keyof State & string,
  value: unknown,
) => PlannedEvent;

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

export function changedFields<State extends object>(
  current: State,
  patch: Partial<State>,
): Set<keyof State> {
  const changed = new Set<keyof State>();
  for (const key of Object.keys(patch) as Array<keyof State>) {
    const cur = (current as Record<keyof State, unknown>)[key];
    const next = (patch as Record<keyof State, unknown>)[key];
    if (!deepEqual(cur, next)) changed.add(key);
  }
  return changed;
}

export function planUpdate<State extends object>(
  id: string,
  current: State,
  patch: Partial<State>,
  build: FieldEventBuilder<State>,
): PlannedEvent[] {
  const events: PlannedEvent[] = [];
  for (const field of changedFields(current, patch)) {
    events.push(build(id, field as keyof State & string, (patch as Record<keyof State, unknown>)[field]));
  }
  return events;
}

export interface ApplyUpdateOptions<State> {
  build: FieldEventBuilder<State>;
  actor: string;
  assertWritable: (state: State | null, id: string) => State;
}

export async function applyUpdate<State extends object>(
  base: EntityApi<State>,
  id: string,
  patch: Partial<State>,
  options: ApplyUpdateOptions<State>,
): Promise<State> {
  const current = options.assertWritable(await base.findOneById(id), id);
  const planned = planUpdate(id, current, patch, options.build);
  if (planned.length === 0) return current;
  let state = current;
  for (const ev of planned) {
    state = await base.createEvent(id, (s) => {
      options.assertWritable(s, id);
      return { eventType: ev.eventType, eventVersion: ev.eventVersion, payload: ev.payload, actor: options.actor };
    });
  }
  return state;
}
