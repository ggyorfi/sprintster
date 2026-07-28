# 8. Content-addressed blobs, stored on the filesystem

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `8bd406f` through
`873f8c2`.

## Status

Accepted

## Context

Images and uploads need somewhere to live. The event log is the wrong place for
bytes: it is append-only, read by folding, and replicated as the source of
truth. Putting megabytes of image into it makes every read worse.

We did build in-database blob stores for both sqlite and postgres before
settling this.

## Decision

Blobs are content-addressed by sha256. `BlobStore`
(`engine/src/blobs/store.ts`) is the interface: `putBlob`, `getBlob`, `hasBlob`.

Bytes live on the filesystem, under a per-environment blob directory, with a
two-level fan-out (`root/ab/cd/<hash>`) so no directory grows unbounded.

Each upload appends a `BlobUploaded` fact to an internal `__blob` stream keyed
by the hash. Because the stream id is the content hash, re-uploading identical
bytes records exactly one event and is naturally idempotent.

## Consequences

- Deduplication is free. The same file uploaded twice is one blob, and callers
  do not have to think about it.
- URLs are immutable, so `/assets/<hash>` can be cached forever.
- The in-database blob stores were removed as unused (`873f8c2`). The filesystem
  is the only path, which is simpler but means object storage would be a new
  implementation rather than a config change.
- The blob directory is operational state. It must be backed up alongside the
  database, and a restore of one without the other is broken.
- Nothing records which records reference a blob. That gap is what ADR 9
  addresses.
