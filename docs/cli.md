# CLI (`s8r`)

`s8r` is the sprintster command line. It reads `sprintster.config.json` from the
current directory (or the path in `SPRINTSTER_CONFIG`) and runs your app.

## Commands

### `s8r dev`

Runs the daemon (HTTP API plus the web GUI), opens the GUI in your browser, and
starts the terminal UI against the same data. This is the everyday command.

```
s8r dev [--env <name>] [--no-open]
```

- `--env <name>`: which environment to run (defaults to `dev`).
- `--no-open`: do not open the browser.

### `s8r daemon`

Runs only the daemon (API and web GUI) in the foreground, no TUI. Use this for a
server, or when you only want the web GUI.

```
s8r daemon [--env <name>]
```

### `s8r migrate-assets`

Rewrites `/assets/<hash>` URLs in markdown bodies to the
[asset](./objects-and-properties.md#assets) records holding those files. Bodies
written before the project had an asset object point at bytes, so replacing a
file never reached them; after this they point at the record and do.

```
s8r migrate-assets [--env <name>] [--dry-run]
```

Safe to run more than once: a rewritten body has no hash left to match. A hash
that no asset holds is left alone and reported, as is one held by more than one
asset, since nothing can say which was meant. Each rewrite is an ordinary update
event, so it appears in the record's history like any other edit.

### `s8r`

With no arguments, opens just the terminal UI against a running daemon (as
configured for the `dev` environment).

## What the daemon serves

- The HTTP API for every object (list, get, create, update, remove, and status
  transitions), under `/<objects>` (the object's `route`; see
  [Objects and properties](./objects-and-properties.md#route)).
- A [singleton](./objects-and-properties.md#singleton) object instead serves the
  record itself at its route: `GET` always returns an object (never a list, never
  404) and `PATCH` updates it. It has no create, delete or `/:id` routes.
- `GET /config`: the app config the frontends render from.
- `POST /assets` and `GET /assets/:hash`: image upload and serving. The `:hash`
  is always a sha256 (64 lowercase hex characters); any other `/assets/*` path
  falls through to static serving. An upload must be a PNG, JPEG, GIF, WebP or
  AVIF of at most 10 MB: a larger one is refused with `413 too_large` and
  anything else with `400 bad_request`, both naming the problem in `message`.
  SVG is not accepted, because blobs are served from the app's own origin and an
  SVG opened directly would run its scripts there. The limits live in the
  daemon, so they apply to every client and not only to the bundled GUI.
- `GET /assets/:id`: the file the [asset](./objects-and-properties.md#assets)
  with that id currently holds, when the config names an `assets` object. Unlike
  the hash URL it is not immutable, since replacing the asset's file changes what
  it serves, so it carries a short `max-age` and an `ETag` set to the content
  hash: an unchanged image answers `304`. `HEAD` returns the same `ETag` with no
  body, which is the cheapest way for a build to learn an asset's current hash
  before caching the bytes under the immutable `/assets/:hash` URL.
- The type of an upload is read from its leading bytes, never from the
  `Content-Type` the client puts on the multipart part. A valid image is
  therefore accepted whether or not the client bothered to declare a type, and
  mislabelling a file cannot get it past the allow list. The `contentType` in
  the response and on `GET /assets/:hash` is the detected one, so it always
  describes the bytes being served. Responses also carry
  `X-Content-Type-Options: nosniff`.
- `GET /health`: a liveness probe reporting the engine version.
- The built web GUI (if present), served as a single-page app. Its bundle files
  are served from `/_app/`, kept out of `/assets/` so they cannot collide with
  blob URLs. Paths with a file extension 404 when missing; extensionless paths
  fall back to `index.html` so client-side routes work.

### Unmatched paths

The first segment of the path decides whether a request belongs to the API or to
the web GUI. An object's `route`, plus `health`, `config` and `assets`, are API
namespaces; every other first segment belongs to the client.

So a path the API does not recognise gets a JSON 404 body of the usual shape when
its first segment is an API namespace, and falls back to `index.html` otherwise:

```
GET /site-settings/x    404  {"code":"not_found","message":"no route for GET /site-settings/x"}
GET /pages/<id>/extra   404  {"code":"not_found",...}
GET /config/x           404  {"code":"not_found",...}
GET /unknown-object     200  index.html (a client-side route)
```

This holds whether or not a web GUI is mounted, so a malformed or out-of-date
request is never answered with HTML and a 200.

`/assets` is the one shared namespace, since bundle files may sit alongside blob
URLs there. Only its extensionless paths get the JSON 404; a path with a file
extension still falls through to static serving, and 404s as a missing file.

## Environment variables

- `SPRINTSTER_CONFIG`: path to the config file (default:
  `./sprintster.config.json`).
