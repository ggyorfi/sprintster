# 9. Asset and image handling

Date: 2026-07-28

## Status

Accepted. Implementation is tracked in [ROADMAP.md](../../ROADMAP.md).

## Context

Blobs can be uploaded and served (ADR 8), and an `image` property can hold one,
but there is no way to put an image inside a markdown body. Worse, the WYSIWYG
editor does not merely lack the affordance: it destroys existing markdown
images, because `StarterKit` has no image node and `@tiptap/markdown` falls back
to descending into the token's children, which for an image token is the alt
text.

Separately, we want an aggregate view over assets, which means answering "which
objects use this asset?". Nothing indexes that direction, and with fold-on-read
and no projection layer (ADR 3) the only way to answer it today is to read
everything.

## Decision

**Stored content holds `/assets/<hash>`, root-relative, always.** `assetUrl()`
resolves against the API base only at render. An absolute URL in stored content
would make the content itself environment-specific.

The normalisation is deliberately narrow: it strips our own configured API base,
whether that is a full origin or a proxied path prefix, and nothing else. A URL
pointing anywhere but our asset route is content, not an asset reference, and is
left exactly as the author wrote it.

**The stored form is plain CommonMark**, `![alt](/assets/<hash>)`. No HTML, no
custom syntax, no dimension metadata: consumers parse bodies with ordinary
markdown tooling, and real dimensions are read from the blob.

**We adopt `@tiptap/extension-image`**, which ships working markdown handlers,
and extend it to override `renderMarkdown`. That override is the single choke
point where an absolute URL is normalised back to root-relative. Resize is off,
so no width or height enters the document, and the markdown title is never
authored though it is preserved if an imported body has one.

Two of its options do less than their names suggest, measured rather than
assumed. `inline: false` does not force images onto their own line: markdown
position is preserved on a round trip, so an image inside a sentence stays
inside it. `allowBase64: false` only governs the HTML paste rule, so a `data:`
URL already present in markdown parses and round-trips. Neither is a problem for
preservation, where reproducing the author's content is the correct behaviour,
but rejecting `data:` URLs is the normalisation override's job rather than the
option's.

**Upload mechanics are shared as a hook, not a widget.** The image property and
the in-prose image have genuinely different stored shapes, but identical upload,
error and validation behaviour. Limits are fixed and enforced server-side, so
they also apply to clients talking to the API directly.

**What counts as an acceptable upload is one function in the engine**
(`assetUploadProblem`): at most 10 MB, and PNG, JPEG, GIF, WebP or AVIF. The
daemon enforces it and answers `413` or `400`; the widgets call the same function
first only to avoid sending a file we already know will be refused. There is no
per-property override, so a limit cannot differ between two fields by accident.

**The bytes decide the type, not the client's label.** `sniffImageType` matches
the leading bytes against the accepted formats, and the result is what we
validate, what we store, and what `GET /assets/:hash` serves. A declared
`Content-Type` is chosen by the caller, so validating it both rejected valid
images that arrived unlabelled (curl and importers send
`application/octet-stream`) and let an excluded format through under a false
label. Deriving the type also means the stored `contentType` cannot disagree
with the bytes, which consumers processing blobs depend on. Responses carry
`X-Content-Type-Options: nosniff` so nothing rests on browser sniffing rules.

**SVG is not accepted.** Blobs are served from the application's own origin with
their stored content type, so an SVG opened directly would execute its scripts
there, against the app's session. That is a stored cross-site-scripting shape,
and excluding the format is cheaper than defending it with headers or a
sandboxed origin. The exclusion is only worth anything because the check reads
the bytes: an allow list applied to a self-declared label is advisory. Revisit
only alongside a decision about how blobs are served.

**References are indexed as events.** An engine-side extractor maps a property
value to the hashes it references, exhaustively over property types. Writes
append `AssetReferenced` and `AssetDereferenced` facts to a stream keyed by the
hash, so "who uses this?" is a single `findByStream` rather than a scan. A
reference names object, id and property, and is deduplicated per property.

**The index is derived, not authoritative.** It is persisted for the lookup but
reconstructible from the object log, and rebuilt by a documented manual command.

**Garbage collection is a non-goal.** Not "not yet": this index cannot answer
the question deletion needs. It reports what references an asset now, while the
event log still contains the hash in older payloads, so replay, audit and export
all touch that history. Deleting blobs is gated on a retention policy for
historical references, not on this index.

## Consequences

- Content is portable across environments, and the CMS can parse bodies with
  stock markdown tooling.
- Every new property type has to be considered by the extractor, and the
  exhaustive switch makes that a compile error rather than an oversight.
- Every create, update and remove now does reference derivation on the write
  path. Small, but no longer free.
- The index is another thing that can be wrong. Making it derived is what keeps
  that recoverable, at the cost of maintaining a backfill forever.
- Blobs still accumulate and nothing reclaims them. The asset view may report
  that nothing references an asset, as information, but offers no delete.
