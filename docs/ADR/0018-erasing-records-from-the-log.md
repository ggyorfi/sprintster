# 18. Erasing records from the log

Date: 2026-11-10

## Status

Accepted.

## Context

The log only grows. Removing a record (`softDelete`) or clearing a field
appends an event, and every earlier event keeps the old values. Two needs do
not fit that:

- **Personal data with a retention limit.** An app that promises to drop an
  address after some days must remove it from storage, not only from the
  current state. Clearing the field leaves the address in the record's
  `Added` event, in exports taken afterwards, and, for a `unique` field, in
  the internal `__unique` claim streams, whose ids carry the value.
- **Short-lived records.** A record that is useless once expired (a hold, a
  token) still costs storage forever, and a public route that creates them
  lets anyone grow the log without limit.

Event stores answer this in a few ways:

- **Crypto shredding.** Personal data is encrypted with a key per subject, and
  deleting the key makes it unreadable while the log stays intact
  ([AxonIQ](https://www.axoniq.io/blog/protect-sensitive-data-in-an-event-sourced-application),
  [Kurrent](https://kurrent.io/blog/protecting-sensitive-data-in-event-sourced-systems-with-crypto-shredding-1)).
  It needs key management, every read decrypts, and its standing under the
  GDPR varies by country
  ([AxonIQ forum](https://discuss.axoniq.io/t/event-sourcing-and-gdpr-compliance/1261)).
- **Forgettable payloads.** Personal data lives in a separate store and events
  reference it
  ([Verraes](https://verraes.net/2019/05/eventsourcing-patterns-forgettable-payloads/)).
  A second store for every app, and a different model for some properties.
- **Deleting or rewriting events.** KurrentDB's hard delete removes a stream's
  events at the next scavenge and leaves a tombstone so the stream stays
  closed ([Kurrent docs](https://docs.kurrent.io/server/v5/streams)); Marten
  masks protected fields in stored events in place
  ([Marten](https://martendb.io/events/protection)).

Our stores are SQL tables that sprintster owns outright, one per app, so
rewriting rows is a plain transaction.

## Decision

**Two operations on an object's API: `erase(id)` deletes a record's events
for good, and `redact(id, fields)` sets the named fields to null in every
event of the record.** Both rebuild the record's stored state (gone after an
erase) and run in one store transaction. They are for code, not people: the
object API and plugins' `ctx.data.object(name)` offer them; no HTTP route or
GUI action does.

- **Store primitive.** `EventStore.rewriteStreams(marker, rewrites)` appends
  `marker`, then for each stream either deletes its events and state or
  replaces its events' payloads by id and stores the given state. Each
  rewrite names the stream head it was planned against; a different head
  refuses the whole call with `UniqueViolationError`, and the object API
  retries like any other write.
- **A marker, not a tombstone in the record's stream.** The marker is an
  event in the internal `__erased` stream (`RecordErased` or
  `RecordRedacted`, payload `{ object, id }` plus the field names), never the
  values. It is appended before anything is deleted, so the log's position
  still only grows: a store whose ids are plain rowids would otherwise reuse
  the id of a deleted last event. `GET /log` and `ctx.data.changesSince`
  report it as a change to the record, so a publisher rebuilds without the
  record. Unlike a KurrentDB tombstone it does not close the id; a later
  `add` with the same id starts a new record.
- **Unique claims go with the values.** For each `unique` field touched, the
  claim streams of every value the record ever held are deleted, unless
  another live record holds that value now. An erased record's values are
  free again.
- **Redaction** rewrites `Added` payloads and the `FieldChanged` events of
  the named fields. The id, the lifecycle field and `sequence` fields cannot
  be redacted. Timestamps stay as they were.
- **Physical deletion.** The SQLite store turns on `secure_delete`, which
  overwrites deleted content with zeros
  ([SQLite](https://www.sqlite.org/pragma.html#pragma_secure_delete)).
  Postgres keeps dead rows until vacuum. A Durable Object can be restored to
  any point in the past 30 days
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/sql-storage/)),
  so erased data stays in its recovery history for that long; a retention
  promise has to allow for it.

## Consequences

- An app can keep a retention promise and cap short-lived records with a
  periodic `erase`, typically from a plugin.
- Copies made before an erase (`s8r export` folders, backups, a store's
  recovery window) still hold the data; erasing does not reach them.
- A rebuilt state can differ from what readers saw before, by design.
- Every store implements one more method.
