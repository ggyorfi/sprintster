# Objects and properties

Your app is a list of **objects**. Each object is a typed record with a
lifecycle, a set of **properties** (fields), one or more **list** screens, and
**views** (forms). Objects live under `app.objects` in your config.

## Object shape

```jsonc
{
  "name": "post",
  "title": "Post",
  "titlePlural": "Posts",
  "lifecycle": { "softDelete": "removed" },
  "properties": [ /* fields */ ],
  "lists": [ /* table screens */ ],
  "views": [ /* forms */ ],
  "commands": [ /* status transitions, optional */ ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Unique machine name (used in event names). |
| `title` / `titlePlural` | yes | Display names. |
| `route` | no | HTTP path segment; defaults to the slug of `titlePlural` (see below). |
| `lifecycle` | yes | How records are retired (see below). |
| `properties` | yes | The fields (at least one). |
| `lists` | no | Table screens; see [Views and lists](./views-and-lists.md). |
| `views` | no | Forms; see [Views and lists](./views-and-lists.md). |
| `commands` | no | Named status transitions (requires a `statusField` lifecycle). |

## Route

Each object is served by the daemon under a path derived from `titlePlural`:
lowercased, accents folded to ASCII, runs of whitespace, underscores and
punctuation collapsed to a single `-`, anything left outside `[a-z0-9-]`
dropped.

| `titlePlural` | path |
|---|---|
| `Posts` | `/posts` |
| `Site Settings` | `/site-settings` |
| `Beállítások` | `/beallitasok` |

Set `route` explicitly when the label and the URL should differ. The value must
already be a slug.

```jsonc
{ "titlePlural": "Site Settings", "route": "config-panel" }   // served at /config-panel
```

Routes are resolved when the config loads, so `GET /config` reports the
resolved `route` on every object: a client never has to re-derive it. Loading
fails if two objects resolve to the same path, if a label slugs to nothing, or
if a route collides with `health`, `config` or `assets`.

## Lifecycle

Every object declares how a record is retired, one of:

- **Soft delete**: `{ "softDelete": "removed" }`. Names a `boolean` property that
  is flipped to `true` on delete. Removed records drop out of lists but their
  history is kept. Deleting requires this lifecycle.
- **Status field**: `{ "statusField": "status" }`. Names an `enum` property that
  moves between states via `commands` (e.g. `draft` to `published`), rather than
  being deleted.

## Property basics

Every property has these common fields:

```jsonc
{
  "name": "title",
  "title": "Title",
  "type": "text",
  "nullable": false,
  "editable": "always",
  "default": "Untitled",
  "system": false,
  "validation": { "required": true, "maxLength": 200 }
}
```

- `name` (required) and `type` (required).
- `title`: display label (falls back to `name`).
- `nullable`: allow `null` (defaults to not nullable).
- `default`: initial value when the field is omitted on create.
- `system`: internal fields (like `id` and the soft-delete flag) that are not
  authored in forms.
- `editable`: `"always"` (default), `"onCreate"` (set once, then read-only), or
  `"never"` (derived, never editable).
- `validation`: see [Validation](#validation).

## Property types

| Type | Value | Notes |
|---|---|---|
| `id` | string | Primary key. `"strategy": "uuid"` (client-minted) or `"sequence"` (server-allocated number). Usually `system: true`. |
| `text` | string | Single or multi-line (see `rows` in a view). |
| `code` | string | Source code editor with highlighting. `"language"`: e.g. `markdown`, `html`, `css`, `json`, `plaintext`. |
| `markdown` | string | Rich Markdown editor; stores raw CommonMark. `"editor"`: `wysiwyg`, `source`, or `combo` (default). |
| `enum` | string | One of `"values": ["a", "b"]`. Renders as a select. |
| `money` | string | Integer minor units as a string (e.g. pence). `"currency": "GBP"`. |
| `integer` | number | Whole number. |
| `date` | string | ISO date, `YYYY-MM-DD`. |
| `datetime` | string | ISO 8601 instant, stored in UTC to the second. |
| `ref` | string | A reference (id) to another object. `"target": "user"`, optional `"display": "name"`. Existence is checked on write. |
| `refs` | string[] | An ordered set of references. `"target": "tag"`. Honors `minItems`/`maxItems`. |
| `boolean` | boolean | true/false. |
| `sequence` | number | Server-allocated incrementing number (read-only). |
| `image` | object | Uploaded image reference: `{ hash, filename, contentType, size, width?, height?, alt? }`. Bytes stored on the filesystem; see [blobs](./configuration.md#blobs). |
| `object` | object | A nested group: `"properties": [ ... ]`. |
| `array` | array | A repeating group of items: `"item": { "properties": [ ... ] }`. Honors `minItems`/`maxItems`. |

Example fields:

```jsonc
{ "name": "body",      "type": "markdown" }
{ "name": "hero",      "type": "image" }
{ "name": "publishedAt","type": "datetime" }
{ "name": "author",    "type": "ref",  "target": "user", "display": "name" }
{ "name": "tags",      "type": "refs", "target": "tag" }
{ "name": "slug",      "type": "text", "validation": { "required": true, "unique": true, "caseInsensitive": true } }
```

## Validation

Set on a property's `validation` object. Rules apply per type.

| Rule | Applies to | Meaning |
|---|---|---|
| `required` | any | Value must be present on create. |
| `minLength` / `maxLength` | text, code, markdown | String length bounds. |
| `min` / `max` | integer | Numeric bounds. |
| `minItems` / `maxItems` | array, refs | Item-count bounds. |
| `format: "email"` | text | Must be a valid email. |
| `unique` | scalar fields | Value must be unique across live records of the object (frees up when a record is removed). Rejected on `id`, `sequence`, `object`, `array`, `refs`, `image`, and nested fields. |
| `caseInsensitive` | with `unique` | `Foo` and `foo` collide (for slugs, emails). Only valid alongside `unique`. |

Uniqueness is enforced atomically, so two concurrent writes of the same value
cannot both succeed; the loser gets a clear field error.

## Nested and repeating fields

```jsonc
{
  "name": "address",
  "type": "object",
  "nullable": true,
  "properties": [
    { "name": "line1", "type": "text", "nullable": true },
    { "name": "postcode", "type": "text", "nullable": true }
  ]
}
```

```jsonc
{
  "name": "emails",
  "type": "array",
  "item": { "properties": [
    { "name": "value", "type": "text" },
    { "name": "label", "type": "text", "nullable": true }
  ] }
}
```
