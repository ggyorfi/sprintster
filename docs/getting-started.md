# Getting started

## Requirements

- Node.js 22 or newer.

## Scaffold a project

```
npm create sprintster my-app
```

The scaffolder asks for a project name and a production backend (SQLite or
PostgreSQL), then writes:

- `sprintster.config.json`: your app config, seeded with an example `user`
  object and a `dev` environment (SQLite at `.sprintster/dev.db`).
- `package.json`: with `dev`, `daemon`, and `start` scripts wired to `s8r`.
- `.gitignore` and a short `README.md`.

Non-interactive flags:

```
npm create sprintster my-app -- --backend postgres
```

## Run it

From the project directory:

```
s8r dev
```

This starts the daemon (HTTP API plus the web GUI), opens the GUI in your
browser, and drops you into the terminal UI against the same data. Edit
`sprintster.config.json` and restart to see your changes.

Other entry points:

```
s8r daemon   # run only the daemon (API + web GUI), no TUI
s8r          # open just the TUI against a running daemon
```

See [CLI](./cli.md) for all commands and flags.

## Next

- Add or change objects and fields: [Objects and properties](./objects-and-properties.md).
- Configure environments and backends: [Configuration](./configuration.md).
