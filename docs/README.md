# sprintster documentation

sprintster is a config-driven, event-sourced application engine. You declare
your objects, their fields, list views, and forms as data in a single
`sprintster.config.json`; a generic runtime drives the read/write path and
renders both a terminal UI (TUI) and a web GUI from that config. There is no
per-app CRUD code to write.

## Contents

- [Getting started](./getting-started.md): scaffold a project and run it.
- [Configuration](./configuration.md): the `sprintster.config.json` file,
  environments, backends, and blob storage.
- [Objects and properties](./objects-and-properties.md): objects, lifecycle,
  every property type, validation, and editability.
- [Views and lists](./views-and-lists.md): forms (views) and list screens.
- [CLI (`s8r`)](./cli.md): the commands that run your app.

## How it fits together

- You write **objects** (e.g. `user`, `post`) with typed **properties**.
- Each object gets **list** screens (a table with search and row actions) and
  **views** (the create/edit/view form).
- Every write becomes an **event** in an append-only log; the current state of
  any record is folded from its events. Binary uploads (images) are stored on
  the filesystem, content-addressed, and referenced from events.
- The `s8r` CLI runs a daemon (HTTP API plus the web GUI) and a TUI over the
  same config and data.
