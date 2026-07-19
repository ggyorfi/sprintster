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
    "objects": [ /* your objects */ ]
  }
}
```

- `configVersion`: always `"1"`.
- `environments`: named runtime environments (backend + server + blobs).
- `app`: your application (objects, and an optional `theme`). Covered in
  [Objects and properties](./objects-and-properties.md) and
  [Views and lists](./views-and-lists.md).

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

## Data and events

State is never stored directly. Every create, update, or remove appends an
event to an append-only log; a record's current value is folded from its
events. This gives you a full, replayable history for free. You do not manage
this: the runtime handles the read/write path from your config.
