# Plugins

A plugin is an npm package installed in the project and listed in the app
config:

```json
"plugins": [{ "name": "my-plugin", "config": { "label": "Publish" } }]
```

It can export any of:

- `plugin`: a daemon plugin. Its `init(ctx)` registers routes, GUI elements and
  objects.
- `cliPlugin`: CLI commands, run as `s8r <verb>`.
- `contributedObjects`: object configs added to the app, stored and served like
  configured ones.

The design is [ADR 13](./ADR/0013-plugin-routes-and-declarative-gui-extensions.md).

## A daemon plugin

```js
export const plugin = {
  name: 'my-plugin',
  namespace: 'demo',
  version: '1',
  capabilities: [],
  config: z.object({ label: z.string().default('Publish') }),
  init(ctx) {
    ctx.routes.register({
      method: 'GET',
      path: '/status',
      handler: async () => {
        const changes = await ctx.data.changesSince(0);
        return Response.json({ text: `${changes.length} changes`, tone: 'info' });
      },
    });
    ctx.routes.register({ method: 'POST', path: '/run', handler: async () => Response.json({ message: 'Started.' }) });
    ctx.gui.badge({ id: 'status', route: '/status', refresh: 30 });
    ctx.gui.action({ id: 'run', label: ctx.config.label, route: '/run', hotkey: 'p', confirm: 'Run it now?' });
  },
};
```

- **Routes** mount at `/plugins/<namespace><path>`, behind the same auth as the
  rest of the API. Handlers take a standard `Request` and the path params, and
  return a `Response`.
- **Badges** answer `{ text, tone }`, with `tone` one of `neutral`, `info`,
  `success`, `warning`, `danger`. The GUI reloads them every `refresh` seconds
  and after any action.
- **Actions** are buttons that POST to their route and show the reply's
  `message`. In the TUI they run on Ctrl plus their `hotkey`.
- **Channels** push to listening clients: `ctx.channels.open('jobs')` returns
  `{ send(message) }`, and clients open a WebSocket on
  `/plugins/<namespace>/channels/jobs`. Messages are JSON; clients only listen.
  On Cloudflare the Durable Object hibernates while sockets are idle.
- **`ctx.data`** reads the app: `object(name)` is the same object API the
  routes use, `position()` is the event log's position, and
  `changesSince(position)` lists what changed after it. The object API also
  offers `erase(id)` (every event of the record deleted for good) and
  `redact(id, fields)` (the fields set to null in every event), for retention
  and short-lived records (ADR 18); a change list reports either as
  `RecordErased` or `RecordRedacted` on the record.

The web GUI and the TUI show badges and actions from the daemon's `/config`;
no plugin code runs in either.

## Public routes and secrets

A manifest can declare both statically, so hosts read them without running
`init` ([ADR 16](./ADR/0016-public-plugin-routes-and-plugin-secrets.md)):

```js
publicRoutes: [{ method: 'POST', path: '/webhook' }],
secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
```

- **Public routes** are reached without the API's auth. The handler checks
  each request itself (a signature, a rate limit); writes it makes carry no
  user, so it passes an actor such as `plugin:<namespace>`. Every declared
  route must also be registered in `init`, or loading fails.
- **Secrets** arrive in `ctx.secrets`, exactly the declared names: Worker
  secrets on Cloudflare, environment variables on Node. A missing or empty one
  fails loading with an error naming it; names starting with `SPRINTSTER_` are
  reserved. Names in `optionalSecrets` follow the same rules, but may be absent.

## The event log

`GET /log?since=<position>` returns `{ position, changes }`, each change being
`{ position, object, id, event, at }`. A client that remembers a position can
tell exactly what changed since.

## On Cloudflare

A Worker cannot import packages by name at runtime, so pass each plugin the
config lists to `createWorker`:

```ts
import * as myPlugin from 'my-plugin';
const { App, worker } = createWorker(config, { plugins: { 'my-plugin': myPlugin } });
```

A plugin the config names but `createWorker` was not given stops the Worker
from starting.

`createWorker` also returns `isPublic(request)`, true for a declared public
plugin route. Its own Basic Auth lets those through; a gate wrapping `worker`
takes the same function. A gate that ignores it keeps every plugin route
private.
