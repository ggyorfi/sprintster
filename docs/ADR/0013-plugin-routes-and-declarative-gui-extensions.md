# 13. Plugin routes and declarative GUI extensions

Date: 2026-11-01

## Status

Accepted.

## Context

sprintster-cms needs a Publish button with an "unpublished changes" indicator,
and an endpoint a build agent pulls publish requests from. Publishing is a CMS
concept, so none of it belongs in the engine. What the engine lacks is a way
for a package to add any of it:

- Plugins can register objects with the daemon, commands with the CLI and
  objects with the TUI (`engine/src/plugin/types.ts`). They cannot add an HTTP
  route, and nothing reaches the web GUI.
- The plugin loader (`engine/src/plugin/loader.ts`) is not called by any host.
  The daemon, the CLI, the TUI and the Cloudflare Worker all start without
  loading the `plugins` listed in the app config.
- A plugin cannot ask what changed since a point in time: the event store
  answers per stream, and has no position for the log as a whole.

## Decision

### Plugins load in every host

The daemon (Node and Worker) and the CLI load the app config's `plugins`
through `loadPlugins`. A plugin package exports `plugin` for the daemon and
`cliPlugin` for CLI commands, and `contributedObjects` for objects it adds to
the app. On Node an entry names a package, resolved from the project's own
`node_modules`; one that fails to load is logged and skipped, as the loader
already did. A Worker cannot import by name at runtime, so `createWorker` takes
the plugin modules explicitly and matches them to the entries by name; an entry
with no module is a startup error, not a silent skip.

The TUI and the web GUI run no plugin code. Both read what plugins added (objects
and GUI extensions) from the daemon's `/config`.

### Plugins add routes under their namespace

A daemon plugin registers routes:

```ts
ctx.routes.register({ method: 'POST', path: '/requests', handler });
// handler(request: Request, params: Record<string, string>): Promise<Response>
```

They mount at `/plugins/<namespace>/...`. `plugins` and `log` join `health`,
`config` and `assets` as reserved routes, so an object can never take them. Handlers use
the web standard `Request` and `Response`, not Hono, so the API does not tie
plugins to the daemon's framework, and they sit behind the same auth as every
other route. A plugin reaches the app's data through the same object APIs as
any client, passed in its context, never through the store.

### Plugins push over channels

Added 2026-11-01. A client that waits for something, such as a build agent
waiting for publish requests, should not poll: on Cloudflare every poll is a
billed request. A plugin opens a channel and pushes to it:

```ts
const jobs = ctx.channels.open('jobs');
jobs.send({ type: 'job' });
```

Clients connect a WebSocket to `/plugins/<namespace>/channels/<name>`, behind
the same auth, and only listen; messages are JSON. Node keeps the sockets on
the daemon's HTTP server. The Durable Object accepts them through the
hibernation API, so an idle connection costs no duration: Cloudflare bills one
request per connect, nothing for outgoing messages, and nothing for protocol
pings. A client still reads state over HTTP after connecting, so a message sent
while it was away is never needed.

### The GUI is extended by declaration, not by code

A daemon plugin may declare two kinds of GUI element:

```ts
ctx.gui.action({ id: 'publish', label: 'Publish', route: '/requests', confirm: 'Publish the site now?' });
ctx.gui.badge({ id: 'changes', route: '/status', refresh: 30 });
```

- An **action** is a button. Pressing it POSTs to the plugin route and shows
  the response's `message`, or its error. In the TUI it runs on Ctrl plus its
  optional `hotkey`, and asks first when it has a `confirm`.
- A **badge** is short status text. The GUI GETs the route and shows
  `{ text, tone }`, with `tone` one of `neutral`, `info`, `success`, `warning`,
  `danger`; it polls every `refresh` seconds, and again after any action.

Both appear in a fixed place in the app chrome, in declaration order. `/config`
lists them under `extensions`, with routes resolved to full paths, so the web
GUI and the TUI render the same elements from the same data. No plugin code
runs in the browser.

### The log has a position

Each event store reports the log's position, a number that only grows with
every append, `EventStore.position()`, and returns the events after one,
`EventStore.findSince(position)`. The daemon serves both:

```
GET /log?since=<position>  ->  { position, changes: [{ object, id, event, at }] }
```

`changes` names what changed, not the payloads, which stay behind the object
routes and their auth. A plugin remembers a position and compares, which is
all "unpublished changes" needs.

## Consequences

- **Publishing lives in sprintster-cms** as a daemon plugin: its request and
  status routes, a Publish action, a changes badge, and the routes the build
  agent pulls from. The engine learns no CMS word.
- A richer GUI extension, a plugin's own screen or a field widget, is not
  possible. That is deliberate: it would turn the web GUI's React internals
  into a public API. If a real need appears it gets its own ADR.
- Wiring the loader changes startup for every app with `plugins` in its config.
  Apps without plugins are unaffected.
- `position()` and `findSince()` are new methods on every event store, so all
  four stores (in memory, SQLite, Postgres, Durable Object) and the shared
  contract tests gain them. Postgres is covered by type checks only, as before:
  its contract suite needs a database.
