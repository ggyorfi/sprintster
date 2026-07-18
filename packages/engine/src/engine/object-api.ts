import type { z } from 'zod';
import { AlreadyExistsError, InvalidStateError, NotFoundError } from '../errors/api-error.js';
import { createEntityApi, type EntityApi } from '../entity-api/factory.js';
import { applyUpdate } from './diff.js';
import { UniqueViolationError, type EventStore } from '../events/store.js';
import { compileCreateSchema, compileUpdateSchema } from '../config/compile.js';
import type { CommandConfig, ObjectConfig } from '../config/schema.js';
import type { PropertyConfig } from '../config/schema.js';
import { eventTypeNames, objectIdKey } from '../events/names.js';
import { commandEventInfos, lifecycleInfo } from './lifecycle.js';
import { makeReducer } from './reducer.js';
import { nowAsIso } from '../time/index.js';

// Internal stream type backing daemon-allocated `sequence` fields; one stream per object.field (+ scope later).
const SEQUENCE_STREAM_TYPE = '__seq';

export interface ObjectApi<State extends { id: string }> {
  base: EntityApi<State>;
  add(input: unknown, actor?: string): Promise<State>;
  update(id: string, input: unknown, actor?: string): Promise<State>;
  remove?(id: string, actor?: string): Promise<State>;
  runCommand(id: string, name: string, actor?: string): Promise<State>;
  get(id: string): Promise<State | null>;
  list(): Promise<State[]>;
  requireGet(id: string): Promise<State>;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  commands: ReadonlyArray<CommandConfig>;
}

// Resolves a ref target's api so a write can verify the referenced object exists (and is not removed).
export type RefResolver = (name: string) => { requireGet(id: string): Promise<unknown> } | undefined;

export interface CreateObjectApiOptions {
  partitionId?: number;
  actor?: string;
  resolveTarget?: RefResolver;
}

export function createObjectApi<State extends { id: string }>(
  store: EventStore,
  obj: ObjectConfig,
  options: CreateObjectApiOptions = {},
): ObjectApi<State> {
  const partitionId = options.partitionId ?? 0;
  const defaultActor = options.actor ?? 'mihaly';
  const names = eventTypeNames(obj.name);
  const idKey = objectIdKey(obj.name);
  const { field: lifecycleField, kind } = lifecycleInfo(obj);
  const createSchema = compileCreateSchema(obj);
  const updateSchema = compileUpdateSchema(obj);
  const sequenceFields = obj.properties.filter((p) => p.type === 'sequence').map((p) => p.name);
  const refFields = obj.properties
    .filter((p): p is Extract<PropertyConfig, { type: 'ref' }> => p.type === 'ref')
    .map((p) => ({ name: p.name, target: p.target }));
  const commandByName = new Map(commandEventInfos(obj).map((ce) => [ce.command.name, ce] as const));

  const base = createEntityApi<State>(store, {
    partitionId,
    streamType: obj.name,
    reducer: makeReducer<State>(obj),
  });

  // Allocate the next number via the event store's OCC: read the counter stream head, append at head+1, retry on a lost race.
  async function allocate(field: string, actor: string): Promise<number> {
    const streamId = `${obj.name}.${field}`;
    for (;;) {
      const next = (await store.streamHead(partitionId, SEQUENCE_STREAM_TYPE, streamId)) + 1;
      try {
        await store.append({
          partitionId,
          streamType: SEQUENCE_STREAM_TYPE,
          streamId,
          streamVersion: next,
          eventType: 'SequenceAllocated',
          eventVersion: 1,
          payload: { value: next },
          occurredAt: nowAsIso(),
          actor,
          correlationId: null,
        });
        return next;
      } catch (err) {
        if (err instanceof UniqueViolationError) continue;
        throw err;
      }
    }
  }

  // Referential integrity gate: every non-null ref value must resolve to a live target object.
  async function checkRefs(data: Record<string, unknown>): Promise<void> {
    for (const rf of refFields) {
      const value = data[rf.name];
      if (value === undefined || value === null) continue;
      const target = options.resolveTarget?.(rf.target);
      if (target === undefined) {
        throw new InvalidStateError(`ref '${rf.name}': no resolver for target '${rf.target}'`);
      }
      await target.requireGet(String(value));
    }
  }

  function assertLive(state: State | null, id: string): State {
    if (state === null) throw new NotFoundError(obj.name, id);
    if (kind === 'softDelete' && (state as Record<string, unknown>)[lifecycleField] === true) {
      throw new InvalidStateError(`${obj.name} '${id}' has been removed`);
    }
    return state;
  }

  async function add(input: unknown, actor: string = defaultActor): Promise<State> {
    const parsed = createSchema.parse(input) as Record<string, unknown>;
    await checkRefs(parsed);
    const id = parsed['id'] as string;
    const { id: _id, ...data } = parsed;
    void _id;
    for (const field of sequenceFields) {
      data[field] = await allocate(field, actor);
    }
    return base.createEvent(id, (state) => {
      if (state !== null) throw new AlreadyExistsError(obj.name, id);
      return { eventType: names.added, eventVersion: 1, payload: { [idKey]: id, ...data }, actor };
    });
  }

  async function update(id: string, input: unknown, actor: string = defaultActor): Promise<State> {
    const patch = updateSchema.parse(input) as Partial<State>;
    await checkRefs(patch as Record<string, unknown>);
    return applyUpdate(base, id, patch, {
      actor,
      assertWritable: assertLive,
      build: (entityId, field, value) => ({
        eventType: names.fieldChanged,
        eventVersion: 1,
        payload: { [idKey]: entityId, field, value },
      }),
    });
  }

  async function get(id: string): Promise<State | null> {
    return base.findOneById(id);
  }

  async function requireGet(id: string): Promise<State> {
    return assertLive(await get(id), id);
  }

  async function list(): Promise<State[]> {
    const all = await base.findMany();
    if (kind === 'softDelete') {
      return all.filter((r) => (r as Record<string, unknown>)[lifecycleField] !== true);
    }
    return all;
  }

  async function runCommand(id: string, name: string, actor: string = defaultActor): Promise<State> {
    const ce = commandByName.get(name);
    if (ce === undefined) {
      throw new InvalidStateError(`unknown command '${name}' on object '${obj.name}'`);
    }
    return base.createEvent(id, (state) => {
      const live = assertLive(state, id);
      const current = (live as Record<string, unknown>)[lifecycleField];
      if (!ce.command.transition.from.includes(String(current))) {
        throw new InvalidStateError(
          `command '${name}': cannot transition from '${String(current)}' (allowed: ${ce.command.transition.from.join(', ')})`,
        );
      }
      return { eventType: ce.eventType, eventVersion: 1, payload: { [idKey]: id }, actor };
    });
  }

  const api: ObjectApi<State> = {
    base,
    add,
    update,
    runCommand,
    get,
    list,
    requireGet,
    createSchema,
    updateSchema,
    commands: obj.commands ?? [],
  };

  if (kind === 'softDelete') {
    api.remove = (id: string, actor: string = defaultActor): Promise<State> =>
      base.createEvent(id, (state) => {
        assertLive(state, id);
        return { eventType: names.removed, eventVersion: 1, payload: { [idKey]: id }, actor };
      });
  }

  return api;
}
