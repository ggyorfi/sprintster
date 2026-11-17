# 28. Reads that do not grow with idle clients

Date: 2026-11-14

## Status

Accepted. Changes ADR 13 (badge `refresh` is gone), ADR 24 (counts and the
default order) and the stale-state check of the state store.

## Context

On Cloudflare every SQL row a Durable Object reads is counted, and the free
plan stops every app of the account for the rest of the day after 5 million.
On 2026-11-14 one admin tab left open did that: its status badge polled every
10 seconds, and each answer read every publication row (about 9,300), so the
tab read about 3 million rows an hour. Other reads grew with the data in the
same way: every list page counted and sorted the whole type, and every woken
Durable Object scanned each type's events to check its stored states.

## Decision

**The log is pushed, not polled.** The daemon serves a WebSocket at
`/log/live` (`LIVE_PATH`). After any request that moved the log it sends
`{ "position": n }` to every client there; a request that wrote nothing sends
nothing. Both hosts accept it (Node with `ws`, the Durable Object with
hibernating sockets, so an open socket keeps nothing awake). `watchLog` in the
engine is the client: it reconnects with backoff from 1 s to 60 s, reports a
reconnect as a change, and can be held. The web GUI keeps one socket per tab,
reloads its badges when the log moves, holds reconnects and reloads while the
tab is hidden and catches up once when it is shown, and shows the socket's
state in the status bar instead of pinging `/health`. The TUI listens too.
`GuiBadge.refresh` is removed.

**States are verified once.** `StateStore.statesVerified(partition, type,
key)` is true when the type's states were last replaced under the same search
key, a one-row read. The entity API checks it first and runs `statesStale`'s
scan only when it is false. The cost is that events appended outside the
engine are no longer noticed after that; such a writer already had to rebuild
states (`POST /log` does).

**Counts are kept.** `state_meta` keeps each type's `total` and `visible`
(shown by the `hide` path it was counted with), updated in the transaction of
every state write and delete, and set by `replaceStates`. A query filtered by
nothing but `hide` reads its total from there (`countKept`); the first one
after the counts were unknown counts once and stores them. Searched and
filtered lists still count their matches. The memory store needs nothing kept.

**The default order is indexed.** `states_created` indexes `createdAt`
descending per type in the SQL stores, and a descending sort no longer starts
its `ORDER BY` with an `IS NULL` term (SQLite puts nulls last in a descending
order anyway; Postgres says `NULLS LAST`), so a page of the default list is
read in index order.

**Plugins may keep derived text.** `PluginData.keep` (`get`, `put`, keys per
plugin) stores text across host restarts. Only the Worker provides it, in the
Durable Object's SQLite (`plugin_keep`, split into rows under the 2 MB row
limit); elsewhere it is absent and a plugin keeps what it derives in memory.

## Consequences

Measured in workerd with 3,000 records of one type:

| Read | Before | After |
|---|---|---|
| First read of a type after a wake | about 6,000 + every state | 2 |
| Default list page | about 8,700 | 112 |
| An idle open admin tab | 3 million an hour (tanarblog) | 0 |

- Every write request reads the log position once more (one row).
- Each state write reads its old state and the type's meta row, and writes the
  meta row: two rows read and one written more.
- A type gets its search key, and so its fast check, on the first wake after
  its first record: one rebuild of a still small type.
- A badge that depends on time alone, with no write, no longer refreshes on
  its own; the publish plugin's scheduled dates come with a write (the agent's
  publish request).
