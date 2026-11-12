# 25. Plugin list columns and action inputs

Date: 2026-11-12

## Status

Accepted. Extends ADR 22.

## Context

A plugin that tracks something per record (a publication state, a sync status,
an order's payment) has no way to show it in a list: list columns are the
object's own properties. Its record actions (ADR 22) live only in the record's
dialog and can only confirm, so an action that needs one value from the user,
such as a date, cannot be offered.

## Decision

**A plugin declares list columns.** `ctx.gui.column({ id, label, objects,
values })`, where `values(object, ids)` returns, for each id, `{ text, tone }`.
The daemon calls it once for the rows it returns from `GET /<route>` (every
row today, one page once lists are paged, ADR 24), and each row carries the
result under the key `<namespace>.<id>`. The web GUI
shows it as a coloured pill; the TUI does not show plugin columns yet. It can be named in a list's
`fields`; it cannot be searched or sorted on.

**A record action can sit in each list row.** `inList: true` on a
`placement: 'record'` action adds a button to each row of the objects it
applies to, beside the row's own actions. `disabledWhen: { column, equals }`
disables it on rows whose plugin column has that text.

**An action can ask for one value.** `input: { type: 'datetime', label,
optional: true }` opens a dialog with that field and the action's label on the
submit button; an optional value can be left empty. The POST body carries
`{ object, id, value }`, `value` null when left empty. `datetime` is the only
input type until another is needed. The TUI asks for no value: it posts
`{ object, id }`, which a plugin reads as an empty optional value.

## Consequences

- Plugins can show per-record state in lists and take one value per action
  without frontend code.
- A column costs one plugin call per list response, not per row.
- Plugin columns are display only: searching or sorting by them would need the
  plugin to answer queries, which is out of scope.
