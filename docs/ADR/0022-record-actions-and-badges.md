# 22. Record actions and badges

Date: 2026-11-12

## Status

Accepted. Extends ADR 13.

## Context

A plugin's GUI actions and badges (ADR 13) sit in the sidebar or on the
Maintenance page and act on the whole app. Some act on one record: publish
this article, resend this order's email, refresh this item from its source.
Without a place on the record, the editor has to leave it and find the record
again elsewhere.

## Decision

**`placement: 'record'`** puts an action or a badge in the record's dialog in
the web GUI and on the record's screen in the TUI. It takes an optional
`objects` list naming the objects it applies to; without it, it shows on every
object.

- A record action POSTs `{ object, id }` as JSON to its route, honours
  `confirm` like any action, and shows the reply's `message`.
- A record badge GETs its route with `?object=<name>&id=<id>` for
  `{ text, tone }` when the record opens and after any of its actions. The web
  dialog closes on save, so the next opening shows the new state; a
  singleton's screen reloads it after a save. The TUI runs a record action
  on the selected row with its Ctrl hotkey and shows no record badges.
- Neither shows on a record that is not saved yet.

## Consequences

- Plugins can offer per-record operations without new frontend code.
- A record badge costs one request per opened record, not one per list row;
  lists do not show them.
