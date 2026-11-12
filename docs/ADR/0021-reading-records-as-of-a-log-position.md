# 21. Reading records as of a log position

Date: 2026-11-12

## Status

Accepted.

## Context

Reads return each record's current state. Some consumers need an earlier one:
a static site generator that publishes the version an editor approved while
newer edits are still being worked on, an audit view, a diff between two
points in time.

The log already has a position (ADR 13): every event's id, which only grows.
A record's state at a position is the fold of its events up to that id.

## Decision

**The object API gains `listAt(at)`**, where `at` is
`{ position: number, positions?: Record<id, number> }`: every record folded
from its events whose id is at most `positions[id]`, or `position` for a record
not named. A record with no event at or below its position is left out, and a
soft-deleted one is left out as `list()` leaves it out. A singleton is
projected from its defaults like `list()` does.

**`GET /<route>?at=<position>`** serves the same with one position for every
record. `PluginObjectApi` offers `listAt` too, so a plugin can serve a read
with per-record positions behind its own route.

`listAt` folds events instead of reading the stored states, which hold only
the latest one.

## Consequences

- Cost grows with the number of events of the object, not the number of
  records. That suits builds and occasional reads, not every page view.
- An erased or redacted record (ADR 18) also reads erased or redacted at
  earlier positions: the history is rewritten, not kept beside it.
- Config changes apply to the fold: an old event is read with today's reducer,
  as every read already is.
