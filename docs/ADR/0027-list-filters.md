# 27. List filters

Date: 2026-11-13

## Status

Accepted. Builds on ADR 24; replaces the unused `filters` list option.

## Context

A list can be searched and sorted (ADR 24) but not narrowed to a kind of
record: images or downloads among media records, visible or hidden articles,
open or paid orders. The config schema had a `filters` option that nothing
read. With paging, a filter has to run in the store like the search, or a page
would hold fewer rows than asked for.

## Decision

**A list declares named filters, each a group of named options:**

```json
"filters": [
  {
    "label": "Type",
    "options": [
      { "label": "Images", "property": "file.contentType", "startsWith": "image/" },
      { "label": "Downloads", "property": "file.contentType", "notStartsWith": "image/" }
    ]
  }
]
```

An option tests one property path with exactly one of `equals`, `notEquals`,
`startsWith` or `notStartsWith`. The path is a property, a field of an object
property, or the `contentType`, `filename` or `size` of an image or file
property; `loadConfig` refuses any other path, an option with no test or more
than one, and repeated labels.

**Requests name options, never conditions.** `GET /<route>?filter=Type:Images`
picks an option of the list's filters; several `filter` parameters, from
different groups, must all hold. The server turns the name into the condition,
so a client cannot query arbitrary fields, and an unknown name is a 400.

**The store applies it** with the search and the paging, in all four stores
(`StateQuery.where`), held to the same answers by the shared contract tests. A
missing value never equals or starts with anything, and always passes a
`notEquals` or `notStartsWith`.

**The frontends offer them.** The web list shows each group as a switch beside
the search (All and the group's options); the TUI cycles the first group with
`f`. Changing a filter starts the list again from its first page.

## Consequences

- Filters cost what a search costs: one condition per chosen option, in the
  store.
- A filter on a computed value needs that value stored or derivable from a
  stored field, as the content type of a file is.
