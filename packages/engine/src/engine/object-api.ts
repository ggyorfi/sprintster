import type { z } from 'zod';
import { AlreadyExistsError, InvalidStateError, NotFoundError, UniqueFieldError } from '../errors/api-error.js';
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

// Internal stream backing field-level `unique`: one stream per (object, field, value), claimed at an odd head, free at an even head (case-sensitive, pending client confirm).
const UNIQUE_STREAM_TYPE = '__unique';

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
    .filter((p): p is Extract<PropertyConfig, { type: 'ref' | 'refs' }> => p.type === 'ref' || p.type === 'refs')
    .map((p) => ({ name: p.name, target: p.target, multi: p.type === 'refs' }));
  const uniqueFields = obj.properties
    .filter((p) => p.validation?.unique === true)
    .map((p) => ({ name: p.name, caseInsensitive: p.validation?.caseInsensitive === true }));
  const uniqueByName = new Map(uniqueFields.map((u) => [u.name, u] as const));
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

  interface Claim {
    field: string;
    value: unknown;
  }

  // Case-insensitive unique fields key their reservation stream by the lowercased value, so `Foo` and `foo` collide.
  function normalizeUnique(field: string, value: unknown): unknown {
    return uniqueByName.get(field)?.caseInsensitive === true && typeof value === 'string' ? value.toLowerCase() : value;
  }

  function uniqueStreamId(field: string, value: unknown): string {
    return JSON.stringify([obj.name, field, normalizeUnique(field, value)]);
  }

  // Reserve a value for a field; throws UniqueFieldError if a live record already holds it. Mirrors allocate()'s OCC loop.
  async function claim(field: string, value: unknown, actor: string): Promise<void> {
    const streamId = uniqueStreamId(field, value);
    for (;;) {
      const head = await store.streamHead(partitionId, UNIQUE_STREAM_TYPE, streamId);
      if (head % 2 === 1) throw new UniqueFieldError(obj.name, field);
      try {
        await store.append({
          partitionId,
          streamType: UNIQUE_STREAM_TYPE,
          streamId,
          streamVersion: head + 1,
          eventType: 'UniqueClaimed',
          eventVersion: 1,
          payload: { field, value },
          occurredAt: nowAsIso(),
          actor,
          correlationId: null,
        });
        return;
      } catch (err) {
        if (err instanceof UniqueViolationError) continue;
        throw err;
      }
    }
  }

  async function release(field: string, value: unknown, actor: string): Promise<void> {
    const streamId = uniqueStreamId(field, value);
    for (;;) {
      const head = await store.streamHead(partitionId, UNIQUE_STREAM_TYPE, streamId);
      if (head % 2 === 0) return;
      try {
        await store.append({
          partitionId,
          streamType: UNIQUE_STREAM_TYPE,
          streamId,
          streamVersion: head + 1,
          eventType: 'UniqueReleased',
          eventVersion: 1,
          payload: { field, value },
          occurredAt: nowAsIso(),
          actor,
          correlationId: null,
        });
        return;
      } catch (err) {
        if (err instanceof UniqueViolationError) continue;
        throw err;
      }
    }
  }

  // Claim each value, rolling back already-made claims if any single one clashes, so a rejected write leaves no reservations.
  async function claimAll(claims: Claim[], actor: string): Promise<void> {
    const done: Claim[] = [];
    for (const c of claims) {
      try {
        await claim(c.field, c.value, actor);
        done.push(c);
      } catch (err) {
        for (const d of done) await release(d.field, d.value, actor);
        throw err;
      }
    }
  }

  async function releaseAll(claims: Claim[], actor: string): Promise<void> {
    for (const c of claims) await release(c.field, c.value, actor);
  }

  const isClaimable = (value: unknown): boolean => value !== undefined && value !== null;

  // Referential integrity gate: every non-null ref (or refs element) value must resolve to a live target object.
  async function checkRefs(data: Record<string, unknown>): Promise<void> {
    for (const rf of refFields) {
      const value = data[rf.name];
      if (value === undefined || value === null) continue;
      const ids = rf.multi ? (Array.isArray(value) ? value : []) : [value];
      if (ids.length === 0) continue;
      const target = options.resolveTarget?.(rf.target);
      if (target === undefined) {
        throw new InvalidStateError(`ref '${rf.name}': no resolver for target '${rf.target}'`);
      }
      for (const id of ids) {
        if (id === undefined || id === null) continue;
        await target.requireGet(String(id));
      }
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
    const claims: Claim[] = uniqueFields
      .filter((f) => isClaimable(data[f.name]))
      .map((f) => ({ field: f.name, value: data[f.name] }));
    await claimAll(claims, actor);
    try {
      for (const field of sequenceFields) {
        data[field] = await allocate(field, actor);
      }
      return await base.createEvent(id, (state) => {
        if (state !== null) throw new AlreadyExistsError(obj.name, id);
        return { eventType: names.added, eventVersion: 1, payload: { [idKey]: id, ...data }, actor };
      });
    } catch (err) {
      await releaseAll(claims, actor);
      throw err;
    }
  }

  async function update(id: string, input: unknown, actor: string = defaultActor): Promise<State> {
    const patch = updateSchema.parse(input) as Partial<State>;
    const patchRec = patch as Record<string, unknown>;
    await checkRefs(patchRec);

    const claimed: Claim[] = [];
    const toFree: Claim[] = [];
    if (uniqueFields.length > 0) {
      const current = await base.findOneById(id);
      const live = current !== null && !(kind === 'softDelete' && (current as Record<string, unknown>)[lifecycleField] === true);
      if (live) {
        const cur = current as Record<string, unknown>;
        for (const f of uniqueFields) {
          if (!(f.name in patchRec)) continue;
          const next = patchRec[f.name];
          const prev = cur[f.name];
          if (normalizeUnique(f.name, next) === normalizeUnique(f.name, prev)) continue;
          if (isClaimable(next)) {
            try {
              await claim(f.name, next, actor);
              claimed.push({ field: f.name, value: next });
            } catch (err) {
              await releaseAll(claimed, actor);
              throw err;
            }
          }
          if (isClaimable(prev)) toFree.push({ field: f.name, value: prev });
        }
      }
    }

    try {
      const result = await applyUpdate(base, id, patch, {
        actor,
        assertWritable: assertLive,
        build: (entityId, field, value) => ({
          eventType: names.fieldChanged,
          eventVersion: 1,
          payload: { [idKey]: entityId, field, value },
        }),
      });
      await releaseAll(toFree, actor);
      return result;
    } catch (err) {
      await releaseAll(claimed, actor);
      throw err;
    }
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
    api.remove = async (id: string, actor: string = defaultActor): Promise<State> => {
      const state = await base.createEvent(id, (s) => {
        assertLive(s, id);
        return { eventType: names.removed, eventVersion: 1, payload: { [idKey]: id }, actor };
      });
      const rec = state as Record<string, unknown>;
      for (const f of uniqueFields) {
        if (isClaimable(rec[f.name])) await release(f.name, rec[f.name], actor);
      }
      return state;
    };
  }

  return api;
}
