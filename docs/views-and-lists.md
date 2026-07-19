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
- `readOnly: true` shows a field but does not let it be edited.
- A dotted property like `"author.name"` shows a read-only field pulled from a
  referenced object.
- A **fieldset** (`"kind": "fieldset"`) groups fields under a titled section.
- The widget for each field is chosen automatically from its property type: a
  select for enums, a searchable picker for refs, a Markdown editor for
  `markdown`, an upload widget for `image`, and so on.

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
