# 7. Semantic validation belongs in loadConfig

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `2f55ba4`.

## Status

Accepted

## Context

zod validates shape. It cannot express that a `ref` points at an object that
exists, that a view names a real property, that two objects do not claim the
same route, or that a singleton declares no lifecycle.

Since behaviour is derived from config (ADR 2), a config that parses but is
semantically wrong does not fail at load. It fails later, inside a request, with
an error that names a runtime symbol rather than the line of config that caused
it. That has been the recurring failure mode of this project.

## Decision

`loadConfig` (`engine/src/config/loader.ts`) parses with `ConfigSchema` and then
runs `validateSemantics`. Every cross-object and cross-field invariant goes
there, not into the schema.

`loadConfig` also validates each object's `route`: it must already be a slug, it
must be unique, and it must not be one of the daemon-reserved `health`, `config`
and `assets`. Routes were originally derived from `titlePlural` and resolved
here; [ADR 11](./0011-routes-are-declared-not-derived.md) made them declared, so
this is now validation only.

## Consequences

- A bad config fails at startup with a message naming the problem, rather than
  during a request.
- There is one place to look for "what makes a config valid", and one place to
  add to.
- The rule to carry forward: when a new class of config goes wrong at runtime,
  the fix belongs in `validateSemantics`, not in the code that tripped over it.
- The check list grows, and it is only as good as our discipline about adding to
  it. Nothing forces a new invariant to be written down.
- Load is slower and stricter. A config that used to start and half-work now
  refuses to start, which is the intent but is occasionally inconvenient.
