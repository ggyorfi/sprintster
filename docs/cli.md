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

### `s8r`

With no arguments, opens just the terminal UI against a running daemon (as
configured for the `dev` environment).

## What the daemon serves

- The HTTP API for every object (list, get, create, update, remove, and status
  transitions), under `/<objects>` (the object's lowercased plural).
- `GET /config`: the app config the frontends render from.
- `POST /assets` and `GET /assets/:hash`: image upload and serving.
- The built web GUI (if present), served as a single-page app.

## Environment variables

- `SPRINTSTER_CONFIG`: path to the config file (default:
  `./sprintster.config.json`).
