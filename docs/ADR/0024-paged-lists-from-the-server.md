# 24. Paged lists from the server

Date: 2026-11-12

## Status

Proposed.

## Context

A list screen fetches every record of the object, in full, and works on that
array in the browser: search (`filterByConfig`, a substring match over the
list's `search.fields`), the labels of ref columns (`enrichRefColumns` fetches
every record of each target too), and rendering every row. Ref pickers and the
card dialog do the same with their target. The TUI does the same.

That was fine for a few hundred records. An app with 5,000 articles sends about
15 MB of JSON, lead and body text included, before the list shows anything,
and renders 5,000 rows. More apps will hit this, and the request shape is what
every frontend and site depends on, so it is settled now.

## Decision

**`GET /<route>` always answers one page:** `{ total, rows }`, at most 200
rows, whatever the request asks for. An unbounded response grows with the
object until it fails: on a Durable Object the whole response is built inside
the isolate's 128 MB, so memory, not time, is the first limit it hits. A caller
that needs every record pages through them (`offset` until `total`); the API
client offers that as one call for scripts and builds. Until every caller does,
a request with no list parameter still gets the bare array, and that ends with
the last step of the epic. The parameters:

| parameter | meaning |
| --- | --- |
| `q` | search: every word must appear in one of the list's `search.fields` (a translated value matches in any language), or the id starts with it when `idPrefix` |
| `sort` | a column key, `-` in front for descending; a ref column's key (`section.title`) sorts by the referenced record's value; missing values last |
| `offset`, `limit` | the page; `limit` defaults to and is at most 200 |
| `fields` | the column keys a row carries, plus `id`; a ref column's key carries the referenced value, a ref thumbnail column its image |
| `list` | the list config whose `search` applies, `default` when absent |

`total` counts the records matching `q`, before `offset` and `limit`.

**List configs gain `sort`** (a column key, `-` for descending), used when the
request has no `sort`. Without it the order stays the store's.

**First the daemon does the work in memory.** It reads the stored states as it
does for a full list, resolves the ref columns asked for from the target
objects' states, then searches, sorts and slices, and sends only the page.
Search, ref labels and sorting move from the web package into the engine, so
the daemon, the web GUI and the TUI share one implementation. That bounds what
is sent, not what is read: every request still parses every state of the
object.

**Then the store answers the query.** `StateStore` gains an optional `query`
the daemon uses when present. The Durable Object store, the one deployed,
implements it first in SQL over its state table: fields read with
`json_extract`, the search as `LIKE` over the search fields, `ORDER BY`,
`LIMIT` and `OFFSET`, and ref columns through a join to the target's state
rows. Only the page's rows reach JavaScript. SQLite and Postgres follow when an
app on them needs it; until then the in-memory path serves them with the same
answers, which the shared store contract tests check.

**Frontends page.**

- The web list fetches pages of 100 as the user scrolls and renders only the
  rows in view (virtual scrolling). Typing a search or choosing a sort starts
  again from the first page; the count shows `total`.
- Ref pickers and the card dialog search on the server as the user types and
  show the first page.
- The TUI fetches a page ahead of its window as the selection moves, and
  searches on the server.

## Consequences

- A list costs one page of small rows instead of every record in full, however
  large the object grows.
- Until a store answers the query itself, the daemon still reads every state
  of the object per request; the store query removes that, store by store.
- Builds and scripts that read everything make one request per 200 records
  instead of one large one.
- A row the list shows is no longer the full record, so both frontends must
  load the record by id before opening it for editing.
- Search results change only in where they are computed: the matching rule is
  the same.
