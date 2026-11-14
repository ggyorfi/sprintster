import type { z } from 'zod';
import { AlreadyExistsError, ConcurrencyError, InvalidStateError, NotFoundError, UniqueFieldError } from '../errors/api-error.js';
import { createEntityApi, type EntityApi } from '../entity-api/factory.js';
import { applyUpdate } from './diff.js';
import { SYSTEM_ACTOR, UniqueViolationError, type EventInput, type EventRow, type EventStore, type StreamRewrite } from '../events/store.js';
import { compileCreateSchema, compileUpdateSchema } from '../config/compile.js';
import type { CommandConfig, ObjectConfig } from '../config/schema.js';
import type { PropertyConfig } from '../config/schema.js';
import { eventTypeNames, objectIdKey } from '../events/names.js';
import { commandEventInfos, lifecycleInfo } from './lifecycle.js';
import { singletonId, synthesizeSingleton } from './singleton.js';
import { hasTimestamps, makeReducer } from './reducer.js';
import { nowAsIso } from '../time/index.js';
import { ERASED_STREAM_TYPE } from '../events/log.js';
import { appConfig } from '../config/app-config.js';
import { encodeCursor, projectRows, searchFieldsOf, toStateQuery, type ListPage, type ListParams } from './list-query.js';
import type { StatePage } from '../events/query.js';

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
  // ADR 18: deletes every event of the record for good.
  erase(id: string, actor?: string): Promise<void>;
  // ADR 18: sets the fields to null in every event of the record.
  redact(id: string, fields: readonly string[], actor?: string): Promise<State>;
  get(id: string): Promise<State | null>;
  list(): Promise<State[]>;
  listAt(at: ListAt): Promise<State[]>;
  // ADR 24: one page.
  query(params: ListParams): Promise<ListPage>;
  // ADR 26: the record as of `position` in a named set, or out of it.
  pin(set: string, id: string, position: number): Promise<void>;
  unpin(set: string, id: string): Promise<void>;
  queryPinned(set: string, params: ListParams): Promise<ListPage>;
  requireGet(id: string): Promise<State>;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  commands: ReadonlyArray<CommandConfig>;
}

// ADR 21: `position` for every record, or the record's own entry in `positions`.
export interface ListAt {
  position: number;
  positions?: Readonly<Record<string, number>>;
}

// Resolves a ref target's api so a write can verify the referenced object exists (and is not removed).
export type RefResolver = (name: string) => { requireGet(id: string): Promise<unknown> } | undefined;

export interface CreateObjectApiOptions {
  partitionId?: number;
  actor?: string;
  resolveTarget?: RefResolver;
}

// Refolds every record of the object from the log into the store's current states, for a store that keeps them.
export async function rebuildObjectStates(store: EventStore, obj: ObjectConfig, partitionId = 0): Promise<void> {
  await createEntityApi(store, { partitionId, streamType: obj.name, reducer: makeReducer(obj) }).rebuildStates();
}

export function createObjectApi<State extends { id: string }>(
  store: EventStore,
  obj: ObjectConfig,
  options: CreateObjectApiOptions = {},
): ObjectApi<State> {
  const partitionId = options.partitionId ?? 0;
  const defaultActor = options.actor ?? SYSTEM_ACTOR;
  const names = eventTypeNames(obj.name);
  const idKey = objectIdKey(obj.name);
  const { field: lifecycleField, kind } = lifecycleInfo(obj);
  const isSingleton = obj.singleton === true;
  const singletonKey = singletonId(obj);
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

  const reducer = makeReducer<State>(obj);
  const base = createEntityApi<State>(store, {
    partitionId,
    streamType: obj.name,
    reducer,
    isCurrent: hasTimestamps,
    searchFields: searchFieldsOf(obj),
  });

  async function targetStates(streamType: string, ids: readonly string[]): Promise<Map<string, unknown>> {
    if (ids.length === 0) return new Map();
    const states = store.states;
    if (states !== undefined) {
      const page = await states.query({ partitionId, streamType, ids, limit: ids.length });
      return new Map(page.states.map((s) => [s.streamId, s.state]));
    }
    const target = appConfig.objects.find((o) => o.name === streamType);
    if (target === undefined) return new Map();
    const fold = makeReducer(target);
    const out = new Map<string, unknown>();
    for (const id of ids) {
      let state: unknown = null;
      for (const e of await store.findByStream(partitionId, streamType, id)) state = fold(state as never, e);
      if (state !== null) out.set(id, state);
    }
    return out;
  }

  async function toPage(page: StatePage, params: ListParams): Promise<ListPage> {
    const rows = await projectRows(obj, page.states.map((s) => s.state), params.fields, appConfig.objects, targetStates);
    return { rows, ...(page.total === undefined ? {} : { total: page.total }), next: encodeCursor(page.next) };
  }

  async function query(params: ListParams): Promise<ListPage> {
    if (isSingleton) return { rows: [(await readSingleton()) as unknown as Record<string, unknown>], total: 1, next: null };
    return toPage(await base.query(toStateQuery(obj, params, appConfig.objects, appConfig.locales ?? [])), params);
  }

  async function pin(set: string, id: string, position: number): Promise<void> {
    const states = store.states;
    if (states === undefined) throw new InvalidStateError('this store keeps no pinned versions');
    const { state } = await base.foldAt(id, position);
    const removed = kind === 'softDelete' && lifecycleField !== null && (state as Record<string, unknown> | null)?.[lifecycleField] === true;
    if (state === null || removed) await states.pins.unpin(set, partitionId, obj.name, id);
    else await states.pins.pin(set, partitionId, obj.name, id, position, state, base.searchText(state));
  }

  async function unpin(set: string, id: string): Promise<void> {
    await store.states?.pins.unpin(set, partitionId, obj.name, id);
  }

  async function queryPinned(set: string, params: ListParams): Promise<ListPage> {
    const states = store.states;
    if (states === undefined) throw new InvalidStateError('this store keeps no pinned versions');
    const q = toStateQuery(obj, params, appConfig.objects, appConfig.locales ?? []);
    return toPage(await states.pins.query(set, { ...q, partitionId, streamType: obj.name }), params);
  }

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
    if (kind === 'softDelete' && lifecycleField !== null && (state as Record<string, unknown>)[lifecycleField] === true) {
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
      const live = current !== null && !(kind === 'softDelete' && lifecycleField !== null && (current as Record<string, unknown>)[lifecycleField] === true);
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

  async function readSingleton(): Promise<State> {
    const stored = await base.findOneById(singletonKey);
    return { ...synthesizeSingleton(obj), ...(stored ?? {}), id: singletonKey } as unknown as State;
  }

  async function saveSingleton(input: unknown, actor: string = defaultActor): Promise<State> {
    const patch = updateSchema.parse(input) as Record<string, unknown>;
    await checkRefs(patch);
    const stored = await base.findOneById(singletonKey);
    if (stored === null) {
      await base.createEvent(singletonKey, (state) => {
        if (state !== null) throw new AlreadyExistsError(obj.name, singletonKey);
        return { eventType: names.added, eventVersion: 1, payload: { [idKey]: singletonKey, ...patch }, actor };
      });
      return readSingleton();
    }
    await applyUpdate(base, singletonKey, patch as Partial<State>, {
      actor,
      assertWritable: (state) => state as State,
      build: (entityId, field, value) => ({
        eventType: names.fieldChanged,
        eventVersion: 1,
        payload: { [idKey]: entityId, field, value },
      }),
    });
    return readSingleton();
  }

  async function get(id: string): Promise<State | null> {
    if (isSingleton) return readSingleton();
    return base.findOneById(id);
  }

  async function requireGet(id: string): Promise<State> {
    if (isSingleton) return readSingleton();
    return assertLive(await get(id), id);
  }

  async function list(): Promise<State[]> {
    if (isSingleton) return [await readSingleton()];
    const all = await base.findMany();
    if (kind === 'softDelete' && lifecycleField !== null) {
      return all.filter((r) => (r as Record<string, unknown>)[lifecycleField] !== true);
    }
    return all;
  }

  async function listAt(at: ListAt): Promise<State[]> {
    const positionOf = (id: string) => at.positions?.[id] ?? at.position;
    const all = await base.findManyAt(positionOf);
    if (isSingleton) {
      const stored = all.find((s) => s.id === singletonKey);
      return [{ ...synthesizeSingleton(obj), ...(stored ?? {}), id: singletonKey } as unknown as State];
    }
    if (kind === 'softDelete' && lifecycleField !== null) {
      return all.filter((r) => (r as Record<string, unknown>)[lifecycleField] !== true);
    }
    return all;
  }

  async function runCommand(id: string, name: string, actor: string = defaultActor): Promise<State> {
    const ce = commandByName.get(name);
    if (ce === undefined) {
      throw new InvalidStateError(`unknown command '${name}' on object '${obj.name}'`);
    }
    if (lifecycleField === null) {
      throw new InvalidStateError(`object '${obj.name}' has no lifecycle; commands require a statusField`);
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

  function redactedPayload(event: EventRow, fields: readonly string[]): unknown {
    const p = event.payload as Record<string, unknown>;
    if (event.eventType === names.added) {
      const hits = fields.filter((f) => f in p);
      return hits.length === 0 ? event.payload : { ...p, ...Object.fromEntries(hits.map((f) => [f, null])) };
    }
    if (event.eventType === names.fieldChanged && fields.includes(String(p['field']))) return { ...p, value: null };
    return event.payload;
  }

  // Every value of the fields the record ever held, by the claim stream that records it.
  function heldClaims(events: readonly EventRow[], fields: readonly string[] | null): Map<string, Claim> {
    const held = new Map<string, Claim>();
    for (const u of uniqueFields) {
      if (fields !== null && !fields.includes(u.name)) continue;
      for (const e of events) {
        const p = e.payload as Record<string, unknown>;
        const value = e.eventType === names.added ? p[u.name] : e.eventType === names.fieldChanged && p['field'] === u.name ? p['value'] : undefined;
        if (isClaimable(value)) held.set(uniqueStreamId(u.name, value), { field: u.name, value });
      }
    }
    return held;
  }

  // ADR 18: one transaction rewrites the record (deleted when `fields` is null) and deletes the claims of its values.
  async function rewriteRecord(id: string, fields: readonly string[] | null, actor: string): Promise<State | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await base.findOneById(id);
      const events = await store.findByStream(partitionId, obj.name, id);
      const last = events[events.length - 1];
      if (last === undefined) throw new NotFoundError(obj.name, id);
      const live = current !== null && !(kind === 'softDelete' && lifecycleField !== null && (current as Record<string, unknown>)[lifecycleField] === true);
      const rewrites: StreamRewrite[] = [];
      for (const [streamId, c] of heldClaims(events, fields)) {
        const claimHead = await store.streamHead(partitionId, UNIQUE_STREAM_TYPE, streamId);
        const ownsNow = live && normalizeUnique(c.field, (current as Record<string, unknown>)[c.field]) === normalizeUnique(c.field, c.value);
        // Held by another record now: its claim, not ours to delete.
        if (claimHead % 2 === 1 && !ownsNow) continue;
        rewrites.push({ partitionId, streamType: UNIQUE_STREAM_TYPE, streamId, expectedVersion: claimHead, payloads: null });
      }
      let state: State | null = null;
      if (fields === null) {
        rewrites.push({ partitionId, streamType: obj.name, streamId: id, expectedVersion: last.streamVersion, payloads: null });
      } else {
        const payloads = new Map<string, unknown>();
        for (const e of events) {
          const payload = redactedPayload(e, fields);
          if (payload !== e.payload) payloads.set(e.id, payload);
          state = reducer(state, { ...e, payload });
        }
        const pinned = store.states === undefined ? [] : await store.states.pins.pinsOf(partitionId, obj.name, id);
        const pins = pinned.map(({ set, position }) => {
          let at: State | null = null;
          for (const e of events) if (Number(e.id) <= position) at = reducer(at, { ...e, payload: payloads.get(e.id) ?? e.payload });
          return { set, state: at, search: base.searchText(at) };
        });
        rewrites.push({
          partitionId,
          streamType: obj.name,
          streamId: id,
          expectedVersion: last.streamVersion,
          payloads,
          ...(store.states !== undefined ? { state, search: base.searchText(state), pins } : {}),
        });
      }
      const markerStream = JSON.stringify([obj.name, id]);
      const marker: EventInput = {
        partitionId,
        streamType: ERASED_STREAM_TYPE,
        streamId: markerStream,
        streamVersion: (await store.streamHead(partitionId, ERASED_STREAM_TYPE, markerStream)) + 1,
        eventType: fields === null ? 'RecordErased' : 'RecordRedacted',
        eventVersion: 1,
        payload: { object: obj.name, id, ...(fields === null ? {} : { fields: [...fields] }) },
        occurredAt: nowAsIso(),
        actor,
        correlationId: null,
      };
      try {
        await store.rewriteStreams(marker, rewrites);
        return state;
      } catch (err) {
        if (!(err instanceof UniqueViolationError)) throw err;
      }
    }
    throw new ConcurrencyError(`${obj.name} '${id}' kept changing during an erase`);
  }

  const unredactable = new Set(['id', ...(lifecycleField !== null ? [lifecycleField] : []), ...sequenceFields]);

  async function erase(id: string, actor: string = defaultActor): Promise<void> {
    await rewriteRecord(id, null, actor);
  }

  async function redact(id: string, fields: readonly string[], actor: string = defaultActor): Promise<State> {
    const known = new Set(obj.properties.map((p) => p.name));
    const bad = fields.find((f) => !known.has(f) || unredactable.has(f));
    if (fields.length === 0 || bad !== undefined) {
      throw new InvalidStateError(bad === undefined ? 'redact needs at least one field' : `'${obj.name}.${bad}' cannot be redacted`);
    }
    const state = await rewriteRecord(id, fields, actor);
    if (state === null) throw new NotFoundError(obj.name, id);
    return state;
  }

  const api: ObjectApi<State> = {
    base,
    erase,
    redact,
    add: isSingleton
      ? async () => {
          throw new InvalidStateError(`'${obj.name}' is a singleton; it always exists and cannot be created`);
        }
      : add,
    update: isSingleton ? (_id, input, actor) => saveSingleton(input, actor) : update,
    runCommand,
    get,
    list,
    listAt,
    query,
    pin,
    unpin,
    queryPinned,
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
