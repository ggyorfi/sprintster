# Views and lists

Each object is presented through **lists** (table screens with search and row
actions) and **views** (the create/edit/view form).

## Lists

A list is a table over an object's records.

```jsonc
"lists": [
  {
    "name": "default",
    "title": "Posts",
    "columns": [
      { "property": "id", "label": "ID", "width": 10 },
      { "property": "title", "label": "Title", "width": 30 },
      { "property": "author.name", "label": "Author", "width": 20 },
      { "property": "publishedAt", "label": "Published", "width": 16 }
    ],
    "search": { "fields": ["title"], "idPrefix": true },
    "filters": [{ "property": "status" }],
    "actions": [
      { "hotkey": "n", "label": "new",  "kind": "create", "view": "default" },
      { "hotkey": "e", "label": "edit", "kind": "edit",   "view": "default" },
      { "hotkey": "v", "label": "view", "kind": "view",   "view": "default" },
      { "hotkey": "d", "label": "del",  "kind": "delete" }
    ]
  }
]
```

- **`columns`**: each has a `property`, optional `label`, `width`, and `suffix`.
  A dotted property like `"author.name"` traverses a `ref` to show a field from
  the target object.
- **`thumbnail: true`** on a column shows a small picture instead of text: the
  image of an `image` property, or of the first record a `ref` or `refs`
  property points at, which must have an image property. The web GUI shows the
  thumbnail stored with the image (made at upload), or the image itself for one
  uploaded without. The terminal list leaves thumbnail columns out.
- **`search`**: `fields` are matched case-insensitively; `idPrefix: true` also
  matches on an id prefix.
- **`filters`**: quick filters by a property (typically an `enum`).
- **`actions`**: keyboard-driven row actions. `kind` is one of `create`,
  `edit`, `view`, or `delete`. All except `delete` name a `view`; `delete`
  requires a `softDelete` lifecycle and can set a `confirm` message.

## Views (forms)

A view is the form used to create, edit, or view a record.

```jsonc
"views": [
  {
    "name": "default",
    "title": "Post",
    "fields": [
      { "property": "title", "placeholder": "e.g. Hello world" },
      { "property": "body" },
      { "property": "author" },
      { "property": "author.name", "readOnly": true, "label": "Author name" },
      {
        "kind": "fieldset",
        "title": "SEO",
        "fields": [
          { "property": "slug" },
          { "property": "hero" }
        ]
      }
    ]
  }
]
```

- Each field references a `property`, with an optional `label`, `placeholder`,
  and `rows` (multi-line height for text/code/markdown).
- `placeholderFrom: "<singleton>.<property>"` shows that singleton's current
  value as the placeholder, in the language being edited: a field left empty
  to fall back on a shop-wide default can show the default. `loadConfig`
  rejects a source that is not a singleton or has no text form. The web GUI
  reads it; the terminal form shows only a plain `placeholder`.
- `visibleWhen: { "property": "stockBy", "equals": "Per variant" }` (or
  `"notEquals"`) on a field or a fieldset shows it only while that property of
  the same record holds the value, live as the form changes; both frontends follow it. A hidden
  field keeps its value and is saved unchanged. `loadConfig` checks the
  property exists, and that the value is one of an enum's values or a boolean
  for a boolean.
- `layout: "table"` on an array field edits it as a table: one row per item,
  its sub-properties as columns (enums as selects), a remove button per row.
- `columnOptions: { "size": "settings.sizes.first" }` on an array field offers
  a column's choices from an array on a singleton, as a select (web GUI). A
  saved value no longer on the list stays visible. `loadConfig` checks both
  ends.
- `labelFrom: "<singleton>.<property>"` takes a field's label from a singleton
  (web GUI); while that value is empty the field is hidden, so an unconfigured
  option disappears. `columnLabelsFrom` does the same for an array's columns,
  and `columnVisibleWhen` shows a column on a condition. Hidden columns keep
  their values.
- `readOnly: true` shows a field but does not let it be edited.
- A dotted property like `"author.name"` shows a read-only field pulled from a
  referenced object.
- A **fieldset** (`"kind": "fieldset"`) groups fields under a titled section.
- `width` sets how wide the web GUI opens the form: `small`, `medium` (the
  default), `large`, or `full`. The terminal form sizes itself from
  `fieldWidth`, a number of characters.
- The widget for each field is chosen automatically from its property type: a
  select for enums, a searchable picker for refs, a Markdown editor for
  `markdown`, an upload widget for `image`, and so on.
- A `ref` or `refs` whose target carries a picture (its own `image`
  property, or the first image behind its list's thumbnail column) is picked
  visually in the web GUI: the chosen records show as cards with thumbnails,
  reordered by drag or arrow buttons, and more are chosen from a searchable
  grid in a dialog. Other refs keep the typeahead, whose list opens above the
  field when there is no room below.

## Commands (status transitions)

Objects with a `statusField` lifecycle can declare named transitions.

```jsonc
"lifecycle": { "statusField": "status" },
"properties": [
  { "name": "status", "type": "enum", "values": ["draft", "published"], "default": "draft" }
],
"commands": [
  { "name": "publish", "hotkey": "p", "transition": { "from": ["draft"], "to": "published" } }
]
```

A command moves a record from one of the `from` states to the `to` state, and
is offered as an action in the UI when the record is in a valid `from` state.
