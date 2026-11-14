# 24. Paged lists from the store

Date: 2026-11-13

## Status

Accepted.

## Context

A list fetched every record of the object, in full, and the browser searched,
resolved ref labels (by fetching every record of each target too) and rendered
every row. An app with 5,000 articles sent about 15 MB before showing anything,
and the daemon built that response inside a Durable Object's 128 MB. An
unbounded response grows with the object until it fails, and doing the work in
the daemon's memory would still read every record on every request.

## Decision

**Every list request answers one page, at most 100 rows.** `GET /<route>`
takes:

| parameter | meaning |
| --- | --- |
| `q` | search: every word must appear in one of the list's `search.fields`, ignoring case and accents ("ora" finds "Óra"); or the id starts with it when `idPrefix` |
| `sort` | a column key, `-` in front for descending; a ref column's key (`section.title`) sorts by the referenced record's value; ties broken by id |
| `fields` | the column keys each row carries, plus `id`; a ref column's key carries the referenced value |
| `list` | the list config whose `search` applies, `default` when absent |
| `limit` | rows per page: 50 when absent, at most 100 |
| `offset` | for screens: answers `{ total, rows }` |
| `after` | for reading everything: an opaque cursor from the previous page; answers `{ rows, next }`, `next` null on the last page |

A request without `offset` or `after` is the first page with offset 0. List
configs gain `sort`, used when the request has none; without either, a list
is newest first (`-createdAt`). `createdAt` and `updatedAt` sort like any
property. A caller that needs every
record follows `next`: one request per page, never one large response. The API
client offers that as `listAll`.

**The store answers the query.** `StateStore` gains `query(...)`, and every
store implements it natively, so only the page's rows are read:

- **SQLite (local), Durable Object (SQLite) and Postgres:** fields read from the
  state JSON (`json_extract`, `->>`), search over a search column, `ORDER BY`
  with the id as tie-breaker, `LIMIT`/`OFFSET` or a keyset condition for
  `after`, `COUNT(*)` for `total`, and ref columns through a join to the target
  object's state rows.
- **In memory:** the same answers in JavaScript, for tests.

The shared store contract tests run every query against every store and
require the same answers.

**The search column.** Each state row carries the text of the object's search
fields (every language of a translated field), lowercased and with accents
removed (Unicode NFKD, combining marks dropped), written in the same
transaction as the state. A query's words are normalized the same way. SQLite's
own `LOWER` only folds ASCII, so the folding happens in the engine, never in
SQL. A config change to `search.fields` rebuilds the column with the states.

**Frontends page.** The web list fetches pages of 100 as the user scrolls and
renders only the rows in view; search and sort start again from the first page.
Ref pickers and the card dialog search on the server. The TUI fetches a page
ahead of its window. Neither lists a whole target object for ref labels any
more: they ask for the ref column's key in `fields`. Plugin columns (ADR 25)
are added to each page.

## Consequences

- No request reads or sends more than one page of rows, inside the store, the
  daemon or the network.
- Every caller that read whole objects changes (frontends, scms, `s8r
  migrate-assets`, tenant scripts); there is no unbounded answer left.
- A store gains a query method and a search column; a new store must implement
  both and pass the contract tests.
- `total` costs a count per offset page; cursor reads skip it.
