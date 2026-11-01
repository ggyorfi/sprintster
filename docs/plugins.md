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
  `changesSince(position)` lists what changed after it.

The web GUI and the TUI show badges and actions from the daemon's `/config`;
no plugin code runs in either.

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
