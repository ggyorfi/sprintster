# 3. Event sourcing with fold-on-read

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `2f55ba4`.

## Status

Accepted

## Context

A config-driven engine (ADR 2) needs one persistence seam that every object
shares, and we wanted history and auditability to be inherent rather than
bolted on later.

## Decision

State is never stored directly. It is folded from an append-only event log.

`EventStore` (`engine/src/events/store.ts`) is the single persistence interface,
and it is deliberately small: `append`, `findByStream`, `findByStreamType`,
`streamHead`. Optimistic concurrency is enforced by a unique
`(partition, streamType, streamId, streamVersion)` constraint that raises
`UniqueViolationError`; `createEntityApi` retries on the clash, five times by
default.

Reads fold a stream through the reducer built from the object's config, so
current state is always a function of the log.

## Consequences

- Full history, audit and actor attribution come for free, on every object.
- Every read folds a whole stream. Cost grows with events per stream, and there
  are no snapshots yet.
- There is no projection or read-model layer. Any query that runs against the
  reverse of the stored direction is a scan, which is why the asset reference
  index in ADR 9 needs a design of its own rather than a query.
- A storage backend only has to implement four methods, so adapters stay small
  and the engine ships `InMemoryEventStore` for tests.
- Corrections are new events, never edits. Nothing is deleted, which is a
  feature for audit and a constraint for anything that wants real deletion.
