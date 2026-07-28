# 2. Config-driven runtime, no per-app CRUD

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `2f55ba4`.

## Status

Accepted

## Context

An application engine can take two routes. It can generate code per app, so
each project ends up owning a copy of the engine's choices, or it can interpret
a declaration at runtime and derive behaviour from it.

Generated code diverges the moment someone edits it, and an engine improvement
then has to be re-applied by hand to every app that was scaffolded from an
older version. We wanted a fix to land once.

## Decision

Objects, properties, lifecycles, commands and views are declared as data: a
`Config`, validated by `ConfigSchema` (`engine/src/config/schema.ts`). A generic
runtime drives the read and write path from it, and both frontends render from
the same declaration. There is no per-app hand-written CRUD.

`makeReducer` builds an object's reducer from its `ObjectConfig`, and
`createEntityApi` is the generic read/write engine that every object shares.

Lifecycle is part of the declaration rather than app code. An object is
`softDelete` (a boolean flipped on remove), `statusField` (an enum advanced only
through named commands, never written directly), or `none`. Lifecycle fields are
excluded from the create and update schemas, so the API cannot be used to
sidestep them.

## Consequences

- An engine improvement reaches every app by upgrading a dependency.
- A new property type is one change in the engine, not one per app.
- Config becomes a hard boundary. Anything an app needs that the config cannot
  express requires extending the schema, not writing app code, which is a real
  constraint and occasionally an unwelcome one.
- The failure mode moves: instead of broken app code, we get config that parses
  but misbehaves at runtime. See ADR 7.
- The runtime carries indirection that generated code would not, and stack
  traces are correspondingly less direct.
