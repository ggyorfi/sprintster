import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { isApiError, type ObjectConfig, type PluginObjectApi } from '@sprintster/engine';

export function createObjectRoute(api: PluginObjectApi<{ id: string }>, obj: ObjectConfig): Hono {
  const route = new Hono();

  route.get('/', async (c) => c.json(await api.list()));

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
        return c.json(await add(c.req.valid('json')), 201);
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
          return c.json(await runCommand(c.req.param('id'), name));
        } catch (err) {
          return apiErrorResponse(c, err);
        }
      }
      const parsed = updateSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ code: 'bad_request', message: parsed.error.message }, 400);
      }
      try {
        return c.json(await update(c.req.param('id'), parsed.data));
      } catch (err) {
        return apiErrorResponse(c, err);
      }
    });
  }

  const remove = api.remove;
  if (remove !== undefined) {
    route.delete('/:id', async (c) => {
      try {
        return c.json(await remove(c.req.param('id')));
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
