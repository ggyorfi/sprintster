import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { isApiError, singletonId, type ListParams, type ObjectConfig, type PluginObjectApi } from '@sprintster/engine';

// The host decides whether a request's Sprintster-Actor header is its own (ADR 20); undefined leaves the api's default.
export type ActorOf = (c: Context) => string | undefined;

// ADR 24: the list parameters of a request; the API checks their values.
function listParams(c: Context): ListParams {
  const q = (name: string) => c.req.query(name);
  const int = (name: string) => (q(name) === undefined ? undefined : Number(q(name)));
  const fields = q('fields');
  const out: ListParams = {};
  for (const [k, v] of Object.entries({ q: q('q'), sort: q('sort'), list: q('list'), after: q('after'), limit: int('limit'), offset: int('offset') })) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  if (fields !== undefined) out.fields = fields.split(',').filter(Boolean);
  if (q('count') === 'false') out.count = false;
  const filter = c.req.queries('filter');
  if (filter !== undefined && filter.length > 0) out.filter = filter;
  const ids = q('ids');
  if (ids !== undefined) out.ids = ids.split(',').filter(Boolean);
  return out;
}

// ADR 25: adds plugin column values to the rows a list returns.
export type DecorateRows = (rows: Array<{ id: string }>) => Promise<Array<{ id: string }>>;

export function createObjectRoute(
  api: PluginObjectApi<{ id: string }>,
  obj: ObjectConfig,
  actorOf: ActorOf = () => undefined,
  decorate: DecorateRows = async (rows) => rows,
): Hono {
  const route = new Hono();

  if (obj.singleton === true) return createSingletonRoute(api, obj, actorOf);

  const listAt = api.listAt;
  const query = api.query;
  route.get('/', async (c) => {
    const at = c.req.query('at');
    if (at === undefined) {
      if (query === undefined) return c.json({ rows: await decorate(await api.list()), next: null });
      try {
        const page = await query(listParams(c));
        return c.json({ ...page, rows: await decorate(page.rows as Array<{ id: string }>) });
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    }
    const position = Number(at);
    if (listAt === undefined) return c.json({ code: 'bad_request', message: `'${obj.name}' cannot be read at a position` }, 400);
    if (!Number.isInteger(position) || position < 0) return c.json({ code: 'bad_request', message: 'at must be a non-negative integer position' }, 400);
    return c.json(await listAt({ position }));
  });

  const status = api.status;
  if (status !== undefined) {
    route.get('/_status', async (c) => c.json(await status()));
  }

  const sync = api.sync;
  if (sync !== undefined) {
    route.post('/_sync', async (c) => {
      try {
        return c.json(await sync());
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  const refresh = api.refresh;
  if (refresh !== undefined) {
    route.post('/:id/_refresh', async (c) => {
      try {
        const row = await refresh(c.req.param('id'));
        if (row === null) return c.json({ code: 'not_found', message: `${obj.name} not found` }, 404);
        return c.json(row);
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  const freeValue = api.freeValue;
  if (freeValue !== undefined) {
    route.get('/_free', async (c) => {
      const field = c.req.query('field');
      const value = c.req.query('value');
      if (field === undefined || value === undefined) return c.json({ code: 'bad_request', message: 'field and value are required' }, 400);
      try {
        return c.json({ value: await freeValue(field, value, c.req.query('id')) });
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  route.get('/:id', async (c) => {
    const id = c.req.param('id');
    const row = await api.get(id);
    if (row === null) return c.json({ code: 'not_found', message: `${obj.name} '${id}' not found` }, 404);
    return c.json(row);
  });

  const add = api.add;
  const createSchema = api.createSchema;
  if (add !== undefined && createSchema !== undefined) {
    route.post('/', zValidator('json', createSchema), async (c) => {
      try {
        return c.json(await add(c.req.valid('json'), actorOf(c)), 201);
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  const update = api.update;
  const updateSchema = api.updateSchema;
  const runCommand = api.runCommand;
  const commands = (obj.commands ?? []).map((cmd) => cmd.name);
  if (update !== undefined && updateSchema !== undefined) {
    route.patch('/:id', async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ code: 'bad_request', message: 'invalid JSON body' }, 400);
      }
      if (typeof body === 'object' && body !== null && '_command' in body) {
        if (runCommand === undefined) {
          return c.json({ code: 'bad_request', message: `'${obj.name}' has no commands` }, 400);
        }
        const name = (body as { _command: unknown })._command;
        if (typeof name !== 'string') {
          return c.json({ code: 'bad_request', message: '_command must be a string' }, 400);
        }
        if (!commands.includes(name)) {
          return c.json({ code: 'unknown_command', message: `unknown command '${name}' on '${obj.name}'` }, 400);
        }
        try {
          return c.json(await runCommand(c.req.param('id'), name, actorOf(c)));
        } catch (err) {
          return apiErrorResponse(c, err);
        }
      }
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ code: 'bad_request', message: parsed.error.message }, 400);
      }
      try {
        return c.json(await update(c.req.param('id'), parsed.data, actorOf(c)));
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  const remove = api.remove;
  if (remove !== undefined) {
    route.delete('/:id', async (c) => {
      try {
        return c.json(await remove(c.req.param('id'), actorOf(c)));
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  return route;
}

// Addressed as an object at the collection path: no create, no delete, no id segment.
function createSingletonRoute(api: PluginObjectApi<{ id: string }>, obj: ObjectConfig, actorOf: ActorOf): Hono {
  const route = new Hono();
  const id = singletonId(obj);

  route.get('/', async (c) => c.json(await api.requireGet(id)));

  const update = api.update;
  const updateSchema = api.updateSchema;
  if (update !== undefined && updateSchema !== undefined) {
    route.patch('/', async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ code: 'bad_request', message: 'invalid JSON body' }, 400);
      }
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ code: 'bad_request', message: parsed.error.message }, 400);
      }
      try {
        return c.json(await update(id, parsed.data, actorOf(c)));
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  return route;
}

function apiErrorResponse(c: Context, err: unknown): Response {
  if (isApiError(err)) {
    return c.json({ code: err.code, message: err.message }, err.statusCode as ContentfulStatusCode);
  }
  throw err;
}
