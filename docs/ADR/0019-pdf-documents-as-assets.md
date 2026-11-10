# 19. PDF documents as assets

Date: 2026-11-10

## Status

Accepted. Widens the upload limits of [ADR 9](./0009-asset-and-image-handling.md);
everything else there stands.

## Context

Uploads were images only (ADR 9). An app that publishes a report, a proposal or
a programme as a PDF had nowhere to keep it: the file lived outside the app, at
a URL that the app could not replace and that disappeared with the old server.

ADR 9 refuses SVG because blobs are served from the app's own origin, where the
session is, and a document that runs scripts there is stored cross-site
scripting. A PDF opened in the browser is a document with its own scripting, so
the same question applies.

## Decision

**`application/pdf` is an accepted upload type,** recognised by its leading
`%PDF-` bytes like every other type (`sniffAssetType`). The 10 MB limit is
unchanged.

**A PDF is never rendered on the app's origin.** The daemon serves every blob
that is not an accepted image with `Content-Disposition: attachment`, both at
`/assets/<hash>` and at `/assets/<id>`. Previewing one from the admin downloads
it. A public site serves its own copy from its own origin, where opening it
inline is fine.

**A new `file` property type holds an image or a PDF;** `image` keeps taking
images only, and its value schema refuses any other content type, so a PDF
cannot slip into a field that templates render as a picture. Both share one
stored shape. Thumbnails, card pickers and list pictures stay `image` only.

**The assets object may hold its file in an `image` or a `file` property,**
still exactly one (ADR 10). `assetFileProperty` finds it for every caller.

**Prose links to a document the way it embeds an image:**
`[label](/assets/<id>)`, root-relative and pointing at the asset record, so a
replacement upload reaches every link. A `markdown` property opts in with
`documents: true`, which gives the web editor a button that uploads a PDF,
creates the record and inserts the link. `loadConfig` refuses `documents` unless
the assets object holds a `file` property.

## Consequences

- Apps can keep their documents with the rest of their content, and a site
  generator can copy them into its output.
- One more property type, which every exhaustive switch over property types
  handles.
- Previewing a PDF in the admin is a download, not a viewer. That is the price
  of keeping the origin image-only.
- Other document types (Office files, plain text) are not accepted. Each would
  need its own signature and the same serving rule, so they wait for a need.
