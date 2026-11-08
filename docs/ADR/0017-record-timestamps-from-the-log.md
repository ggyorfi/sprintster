# 17. Record timestamps from the log

Date: 2026-11-07

## Status

Accepted.

## Context

Every event already carries `occurredAt` (`events/store.ts`), so the log knows
when each record was created and last changed. A record as the API serves it
does not: an app that wants a creation date declares a date property and fills
it by hand, which an author can then edit or forget.

Authors want to see both times on every form, read only, with nothing to
declare.

## Decision

**The reducer folds two system values into every record:** `createdAt`, the
`occurredAt` of its `Added` event, and `updatedAt`, the `occurredAt` of the
latest event that applied to it. Both are ISO 8601 instants, like `datetime`
values. They are part of the record wherever it is read: the object API, the
HTTP routes, stored states, exports.

- **Reserved names.** `loadConfig` rejects a property named `createdAt` or
  `updatedAt`. They are not properties: no view, list column or validation
  rule names them, and writes cannot set them.
- **Imported events keep their times.** `POST /log` appends events as
  exported, so a moved app keeps its records' dates. A record created through
  the API is stamped when the call is made.
- **Singletons** read as an object before their first write; until then they
  have neither value.
- **Stored states written before this change lack the values.** The states
  check that already rebuilds stale states once per api before the first read
  also treats a stored record without `updatedAt` as stale, so every store,
  the Durable Object included, upgrades itself on first read. No command to
  run.
- **Frontends** show both in the record's form header. Sorting a list or a
  site collection by them is a client's choice; sprintster-cms accepts them as
  `sort` keys.

## Consequences

- Apps drop hand-kept "added" dates. A record imported through the API rather
  than `POST /log` gets the import's time; an importer that needs an order
  creates records in that order.
- Every record grows by two short strings.
- Anything comparing whole records (tests, clients) sees two more keys.
