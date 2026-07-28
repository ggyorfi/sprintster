# 6. One config, two frontends, conversions in the engine

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `626c98f` and
`460dfb6`.

## Status

Accepted

## Context

We render the same application as a terminal UI and as a web GUI. Two
independent implementations of "what a money field looks like when you type in
it" drift within weeks, and the drift shows up as a bug in one frontend that
does not reproduce in the other.

## Decision

Both frontends render from the same validated config, and the conversion at the
form boundary lives in the engine, in `engine/src/engine/view.ts`, not in either
frontend. `toInput` turns a stored value into what a field shows; `toStorage`
turns typed input back into a stored value.

`toStorage` returns unparseable input verbatim rather than throwing, so the
server reports a field error and the form does not crash.

## Consequences

- A parsing or formatting fix lands once and both frontends get it.
- The frontends stay presentation: they decide how a field looks, not what its
  value means.
- The engine carries UI-shaped concerns it would otherwise be free of, which
  looks out of place until you have watched two frontends disagree.
- Genuinely frontend-specific behaviour still has to be written twice, and
  telling the two apart is a judgement call each time.
- Validation is centralised on the server, so an invalid value reaches it and is
  reported back rather than being blocked locally in two different ways.
