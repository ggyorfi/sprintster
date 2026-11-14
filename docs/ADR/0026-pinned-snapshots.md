# 26. Pinned snapshots

Date: 2026-11-13

## Status

Accepted. Builds on ADR 21 and ADR 24.

## Context

Reading records as of a log position (ADR 21) folds every event of the object
on every read. A consumer that reads the same chosen versions again and again,
such as a site generator reading each record's published version, pays that
cost each time, and cannot use the store's paged queries (ADR 24), which work
on stored states.

## Decision

**A snapshot set holds one chosen version per record.** `pin(set, object, id,
position)` writes the record's state as of that position into the named set;
`unpin(set, object, id)` marks it removed. Both are written in one transaction
with a pin sequence number that only grows.

- **Reading:** `queryPinned(set, object, query)` takes the same parameters and
  gives the same answers as a list query (ADR 24), over the set's snapshots.
- **Changes:** `pinnedSince(set, sequence)` pages through the snapshots pinned
  or unpinned after a sequence number, removed ones included, so a consumer
  keeps a copy current by asking only for what changed.
- **Erasure (ADR 18):** erasing or redacting a record rewrites or deletes its
  snapshots in the same transaction, and counts as a change.
- **Rebuild:** a set is rebuilt by pinning each record again at its position,
  which the set keeps beside the snapshot.

Plugins reach it through `ctx.data`. Every store implements it natively, like
`query`, with the same contract tests.

## Consequences

- A chosen version is folded once, when pinned, and read like any state after
  that.
- What a set means (published, approved, archived) stays with the plugin that
  pins it; the engine only stores versions.
