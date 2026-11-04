# Configuration

Everything lives in one file: `sprintster.config.json` in your project root
(override the path with the `SPRINTSTER_CONFIG` environment variable).

## Top-level shape

```jsonc
{
  "configVersion": "1",
  "environments": {
    "dev": { "backend": { "kind": "sqlite", "path": ".sprintster/dev.db" } }
  },
  "app": {
    "version": "1",
    "title": "My app",
    "objects": [ /* your objects */ ]
  }
}
```

- `configVersion`: always `"1"`.
- `environments`: named runtime environments (backend + server + blobs).
- `app`: your application (objects, an optional `title` shown by the web GUI
  and defaulting to `sprintster`, an optional `theme`, and an optional `auth`
  with the `login`, `logout` and `refresh` paths of a host that checks
  passwords in front of the daemon, see
  [ADR 14](./ADR/0014-login-screen-for-a-host-provided-auth.md)). Covered in
  [Objects and properties](./objects-and-properties.md) and
  [Views and lists](./views-and-lists.md).

## Sharing a config

Projects that run the same app with small differences can keep the common part
in one file and extend it ([ADR 15](./ADR/0015-config-extends.md)):

```jsonc
{
  "extends": "../shared/portfolio/sprintster.config.json",
  "environments": { "dev": { "backend": { "kind": "sqlite", "path": ".sprintster/dev.db" } } },
  "app": { "title": "Katalin Haász", "locales": ["hu", "en"] }
}
```

The path is relative to the file that declares it, and the shared file may
extend another. Objects merge key by key; anything else, arrays included, is
replaced. Keep `environments` in each project's own file.

A Worker imports its config, so it merges the two itself with `extendConfig`
from `sprintster/cloudflare`:

```ts
import shared from '../shared/portfolio/sprintster.config.json';
import site from './sprintster.config.json';
const { App, worker } = createWorker(extendConfig(shared, site) as { app: unknown });
```

## Environments

Each environment names a backend and (optionally) a server and blob directory.
Select one with `s8r dev --env <name>` (defaults to `dev`).

```jsonc
"environments": {
  "dev": {
    "backend": { "kind": "sqlite", "path": ".sprintster/dev.db" },
    "server":  { "host": "127.0.0.1", "port": 3939 },
    "blobs":   { "dir": ".sprintster/binary-data" }
  },
  "prod": {
    "backend": { "kind": "postgres", "url": "postgres://localhost:5432/app" }
  }
}
```

### Backend

- **SQLite** (zero-infra, great for local): `{ "kind": "sqlite", "path": "..." }`.
  Use `":memory:"` for an ephemeral database.
- **PostgreSQL**: `{ "kind": "postgres", "url": "postgres://..." }`. The
  `events` table (and a `blobs` table if you store blobs in the DB) is
  provisioned out of band.

### Server

`{ "host": "127.0.0.1", "port": 3030 }`. Both fields are optional and default to
those values. The daemon serves the HTTP API and, if built, the web GUI here.

### Blobs

Binary uploads (see the `image` property type) are stored as content-addressed
files on the filesystem.

```jsonc
"blobs": { "dir": ".sprintster/binary-data" }
```

`dir` is optional and defaults to `.sprintster/binary-data`. Bytes are written
as immutable files sharded by content hash, so they are cheap to back up and
never overwritten. The event log only stores a reference plus metadata, never
the bytes.

The directory only grows. Nothing deletes bytes: an upload is a recorded fact,
and a file stays on disk after every record referencing it is gone, because the
event history still names that hash. Size the volume for total uploads over the
life of the project rather than for what is currently in use, and note that it
must be backed up alongside the database. Restoring one without the other leaves
records pointing at files that are not there.

## Data and events

State is never stored directly. Every create, update, or remove appends an
event to an append-only log; a record's current value is folded from its
events. This gives you a full, replayable history for free. You do not manage
this: the runtime handles the read/write path from your config.
