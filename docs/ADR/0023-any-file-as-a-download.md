# 23. Any file as a download

Date: 2026-11-12

## Status

Accepted. Widens [ADR 19](./0019-pdf-documents-as-assets.md) for apps that opt
in; its serving rule stands.

## Context

ADR 19 accepts images and PDFs up to 10 MB. Some apps hand out other files: a
teachers' blog offers worksheets as `.doc`, `.ppt` and SMART Notebook files,
some over 40 MB. Every format has its own signature, so sniffing each one does
not scale, and the 10 MB limit suits a portfolio, not a download library.

A public site also has to serve those files. Copying each into the site's
output (CMS ADR 5) runs into static hosts' limits on file size and count, and
duplicates what the blob store already holds.

## Decision

**App config `uploads`** opts in, per app:
`{ "anyFile": true, "maxMegabytes": 50 }`.

- With `anyFile`, a `file` property and the assets object accept any bytes.
  Images and PDFs are still recognised by their bytes. Any other file takes
  its type from its name's extension through a fixed table of common types,
  else `application/octet-stream`. The client's declared type is never used.
- `maxMegabytes` replaces the 10 MB limit for every upload of the app.
- `image` properties still take images only.

**Serving is unchanged:** only an image opens inline; everything else, at
both asset routes, is sent with `Content-Disposition: attachment` and
`X-Content-Type-Options: nosniff`, so no file runs on the app's origin.

**`blobResponse(blobs, hash, opts)`** is exported from the daemon package: a
host-neutral `Response` for one blob of any `BlobStore` (headers above, an
ETag, `If-None-Match`, `HEAD`, and an optional download file name). The daemon
routes use it, and so can a public site in front of the same store, on Node or
on a Worker with a read-only R2 binding.

## Consequences

- An app can keep large downloads without a static host's limits applying,
  since the files are streamed from the blob store rather than copied.
- A Worker reads a whole blob into memory before sending it; 50 MB fits a
  Worker's memory, and larger limits would need streaming from R2.
- Unknown extensions download as `application/octet-stream`, which every
  browser saves as a file.
