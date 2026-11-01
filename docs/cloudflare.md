# Running on Cloudflare

A sprintster app can run on a Cloudflare account, the free plan included, with
the same config, HTTP API and web GUI it has under Node. One app is one Worker:

- the event log lives in the SQLite storage of a single Durable Object;
- uploaded files live in an R2 bucket, keyed by their hash;
- the web GUI is served as Workers static assets.

> **Set a password before you add data.** Without one, anyone who can reach the
> Worker's URL can read and change every record. See [Password](#password).

## Requirements

- A Cloudflare account, and `npx wrangler login` run once.
- A project scaffolded with `npm create sprintster`.

## Add two files

`worker.ts`, next to `sprintster.config.json`:

```ts
import config from './sprintster.config.json';
import { createWorker } from 'sprintster/cloudflare';

const { App, worker } = createWorker(config);

export { App };
export default worker;
```

`wrangler.jsonc`:

```jsonc
{
  "name": "my-app",
  "main": "worker.ts",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "node_modules/sprintster/dist/web", "binding": "ASSETS", "html_handling": "none" },
  "durable_objects": { "bindings": [{ "name": "APP", "class_name": "App" }] },
  "r2_buckets": [{ "binding": "BLOBS", "bucket_name": "my-app-blobs" }],
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["App"] }]
}
```

The binding names `APP`, `BLOBS` and `ASSETS`, and the class name `App`, are
what `createWorker` expects. `name` and `bucket_name` are yours to choose.

## Deploy

```
npx wrangler r2 bucket create my-app-blobs
npx wrangler deploy
```

Wrangler prints the app's `workers.dev` URL. The API is at its root, as under
`s8r daemon`, and the web GUI opens there in a browser.

## Password

The Worker asks for one user name and password, as HTTP Basic Auth, when both
secrets are set:

```
npx wrangler secret put SPRINTSTER_USER
npx wrangler secret put SPRINTSTER_PASSWORD
```

Each command prompts for the value. Secrets belong to the Worker and survive
redeploys. With neither set the app is open; with only one set every request
fails, so a half-done setup never ends up open. `/health` always answers.

The browser shows its own login prompt and remembers the credentials until it
is closed; there is no logout. The GUI's script and style files are public,
since Cloudflare serves them without running the Worker; they hold no data.

For `wrangler dev`, put both values in a `.dev.vars` file next to
`wrangler.jsonc` and add `.dev.vars` to `.gitignore`.

## What differs from Node

- `environments` in `sprintster.config.json` are not used: storage is always the
  Durable Object and R2.
- The CLI and TUI do not run against a deployed app yet.
- Files the GUI loads are served by Cloudflare without running the Worker, so
  they do not count toward the plan's daily request limit. API calls do.
