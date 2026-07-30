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
  "route": "posts",
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
| `route` | yes | HTTP path segment, declared not derived (see below). |
| `singleton` | no | Exactly one record, forever (see below). |
| `lifecycle` | yes | How records are retired, unless `singleton` (see below). |
| `properties` | yes | The fields (at least one). |
| `lists` | no | Table screens; see [Views and lists](./views-and-lists.md). |
| `views` | no | Forms; see [Views and lists](./views-and-lists.md). |
| `commands` | no | Named status transitions (requires a `statusField` lifecycle). |

## Route

Every object declares the path the daemon serves it under. It is required, and it
is never derived from anything:

```jsonc
{ "name": "post", "title": "Post", "titlePlural": "Posts", "route": "posts" }
```

The route and the labels are independent on purpose. `title` and `titlePlural`
are display strings you are meant to change freely; a route is a URL contract
that other things depend on: stored links, API clients, and the
`/assets/<id>` references inside markdown bodies. Deriving one from the other
would make renaming a heading a breaking change to your API, silently.

The value must already be a slug: lowercase, digits and hyphens only. Loading
fails if it is not, if two objects declare the same route, or if it collides with
the daemon's own `health`, `config` or `assets`.

```jsonc
{ "titlePlural": "Site Settings", "route": "site-settings" }
{ "titlePlural": "Beállítások",   "route": "beallitasok"   }
{ "titlePlural": "Assets",        "route": "media"         }   // 'assets' is reserved
```

`GET /config` reports the route on every object, so a client never has to guess
it, and projects scaffolded by `create-sprintster` come with routes already
written.

## Singleton

`"singleton": true` marks an object that has exactly one record for the life of the
app: site settings, a homepage, a global footer. It declares no `lifecycle`, because
there is nothing to retire, and it must declare at least one `view`, because that
form is its entire UI. Its `lists` are unused and default to empty.

```jsonc
{
  "name": "settings",
  "title": "Site Setting",
  "titlePlural": "Site Settings",
  "route": "site-settings",
  "singleton": true,
  "properties": [
    { "name": "id", "type": "id", "strategy": "uuid", "system": true },
    { "name": "siteTitle", "type": "text", "title": "Site title", "default": "My site" },
    { "name": "baseUrl", "type": "text", "title": "Base URL" }
  ],
  "views": [
    { "name": "default", "title": "Settings",
      "fields": [{ "property": "siteTitle" }, { "property": "baseUrl" }] }
  ]
}
```

A singleton always reads as an object. Before anything is saved it is projected from
its configuration: each field takes its `default`, or a zero value for its type if it
has none.

| type | unset value |
|---|---|
| `text`, `code`, `markdown` | `""` |
| `integer`, `sequence` | `0` |
| `money` | `"0"` |
| `boolean` | `false` |
| `refs`, `array` | `[]` |
| `object` | its sub-fields, projected the same way |
| everything else | `null` |

Because the record is projected before it is ever written, a `required` field must
declare a `default`; loading fails otherwise. A field that is *not* required needs no
default and reads as the zero value above, which is a useful "not configured yet"
signal: an unset `baseUrl` reads as `""`, and a build step can refuse to run on it.

Over HTTP a singleton is the object itself at the collection path, with no id segment
and no create or delete:

```
GET   /site-settings   -> { "id": "settings", "siteTitle": "My site", ... }
PATCH /site-settings   -> the updated object
```

The first `PATCH` writes the record; later ones update it. Fields added to the config
after that keep projecting their default or zero value until they are saved. Both the
web GUI and the TUI open a singleton's form directly instead of listing it.

## Lifecycle

Every object except a singleton declares how a record is retired, one of:

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
| `markdown` | string | Rich Markdown editor; stores raw CommonMark. `"editor"`: `wysiwyg`, `source`, or `combo` (default). `"images": true` allows [in-body images](#images-in-a-markdown-body) and requires an [assets](#assets) object. |
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

### Images in a markdown body

An `image` property holds one image as a field. To put images *inside* prose, use
a `markdown` property: the rich editor can insert them, and they are stored as
ordinary CommonMark.

```markdown
![A blue cover](/assets/a2a08d0b4b53676425...)
```

Authors insert one with the toolbar's image button, or by pasting or dropping a
file into the editor. Any of those uploads the file to
[`POST /assets`](./cli.md#what-the-daemon-serves) and inserts the reference at
the cursor. Content addressing means the same file uploaded twice is one blob,
so there is nothing to deduplicate. A newly inserted image is selected, and an
Alt text field appears above the editor for describing it; alt text is stored in
the markdown itself and left empty until written, which is correct for a
decorative image.

Two guarantees for anything that consumes these bodies:

- **The URL is always root-relative**, `/assets/<hash>`, never absolute. It is
  normalised on save, so a body authored against a dev daemon does not carry
  that host into your database. Resolve it against your API base when rendering.
- **The markdown is plain CommonMark.** No HTML `img`, no custom syntax, and no
  width, height or title metadata. Parse bodies with ordinary markdown tooling
  and read real dimensions from the blob if you need them.

A URL that is not one of our asset references, an external image or a `data:`
URL, is treated as content and left exactly as written.

**A body image points at bytes, not at a record.** That is what makes the
markdown portable, and it has one consequence worth knowing before you rely on
it. If you keep pictures as records of their own and attach them with `ref` or
`refs`, uploading a replacement file updates every one of those attachments,
because they point at the record. Bodies do not follow: they hold the old
content hash and keep showing the old image until someone re-inserts it. For the
same reason, when two records happen to hold the same file, a body cannot say
which of them it meant.

Editing markdown as text, in source mode or in the TUI, preserves images
untouched. Inserting is a web-only affordance; the terminal has no image picker.

Example fields:

```jsonc
{ "name": "body",      "type": "markdown" }
{ "name": "hero",      "type": "image" }
{ "name": "publishedAt","type": "datetime" }
{ "name": "author",    "type": "ref",  "target": "user", "display": "name" }
{ "name": "tags",      "type": "refs", "target": "tag" }
{ "name": "slug",      "type": "text", "validation": { "required": true, "unique": true, "caseInsensitive": true } }
```

## Assets

An `image` property holds a file inline on the record that uses it. That is the
right shape for a one-off, a logo on a settings singleton, and the wrong one as
soon as a picture is shared: two records using the same file each carry their
own copy of its alt text, and editing one does not touch the other.

For anything shared, give pictures an object of their own. There is no built-in
asset type: an asset is an ordinary object that holds its file in an `image`
property, plus whatever else the project wants, and records attach one with
`ref` or `refs`.

```jsonc
{
  "assets": "asset",
  "objects": [
    {
      "name": "asset",
      "title": "Asset", "titlePlural": "Assets",
      "route": "media",
      "lifecycle": { "softDelete": "removed" },
      "properties": [
        { "name": "id",    "type": "id", "strategy": "uuid", "system": true },
        { "name": "file",  "type": "image",    "title": "File" },
        { "name": "title", "type": "text",     "title": "Title" },
        { "name": "alt",   "type": "text",     "title": "Alt text", "nullable": true },
        { "name": "removed", "type": "boolean", "system": true }
      ],
      "lists": [ /* ... */ ]
    }
  ]
}
```

Note the `"route"`. Every object declares one, but this is the one case where the
obvious value is taken: the daemon reserves `assets` for serving files, so an
asset object has to be served somewhere else. Loading a config that claims it
fails with a message saying so.

### The `assets` declaration

`"assets"` names the object that in-body image URLs resolve against. It is a
pointer, not a shape: the object stays entirely yours, and the only thing the
declaration buys is that `/assets/<id>` knows where to look.

It is required as soon as any `markdown` property asks for images:

```jsonc
{ "name": "body", "type": "markdown", "images": true }
```

`images` is off by default. A property that asks for it while no `assets` object
is named is a configuration error, not an editor that quietly lacks a button, so
the mistake surfaces at load rather than when an author goes looking for the
control.

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
