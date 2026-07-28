# 4. The engine is the framework-agnostic core

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `38e37fe`, `2f55ba4`
and `d85ea9d`.

## Status

Accepted

## Context

The project ships a server, two frontends, two storage backends and a CLI. If
the domain logic sits anywhere near any of them, replacing one means untangling
it from the others first.

## Decision

`@sprintster/engine` holds the whole domain: config schema and semantic
validation, the event store interface, the event-sourcing runtime, and the HTTP
API client. It has no HTTP server and no database driver. Its runtime
dependencies are `zod` and `dinero.js`.

Everything else depends on the engine and never the reverse. `daemon` is Hono
over it, `storage-sqlite` and `storage-postgres` implement `EventStore` and
`BlobStore`, `tui` and `web` render from the config it validates, and `cli`
composes them into the `s8r` binary.

## Consequences

- The engine is testable with no server and no database.
- Adding a backend means implementing two small interfaces, not understanding
  the runtime.
- Any of the outer layers can be replaced without touching the domain.
- Anything that needs two layers at once has to be wired in the composition
  layer instead of in either package. Opening a blob store alongside an event
  store lives in `cli/src/backends.ts` for exactly this reason.
- The engine cannot use a convenience from a framework it does not depend on,
  so some things are written out by hand that a framework would have supplied.
