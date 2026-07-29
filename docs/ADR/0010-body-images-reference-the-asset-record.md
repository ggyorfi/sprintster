# 10. Body images reference the asset record, not the blob

Date: 2026-07-29

## Status

Accepted. Supersedes the in-body URL decision in
[ADR 9](./0009-asset-and-image-handling.md); the rest of ADR 9 stands.
Implementation is tracked in [ROADMAP.md](../../ROADMAP.md).

## Context

ADR 9 put the blob hash in stored markdown, `![alt](/assets/<hash>)`. That made
bodies portable and immutably cacheable, and it was what the sprintster-cms team
asked for.

It has one consequence we did not weigh heavily enough. A body points at bytes,
so replacing the file behind a picture updates every `ref` and `refs` attachment
and silently does not update prose. An author replaces a photo, sees it change
on covers, and finds it unchanged in the posts. Nothing surfaces the difference.

The same property makes usage ambiguous: when two records hold one blob, a body
cannot say which it meant, so neither alt text nor a usage report can attribute
it.

## Decision

Stored markdown references the **asset record**, `![alt](/assets/<id>)`. The
markdown stays plain CommonMark, so it is still ordinary content that any
markdown tooling can parse and rewrite.

`GET /assets/<id>` serves the blob that record currently holds. It cannot be
`immutable`, since the whole point is that it changes, so it carries an `ETag`
of the content hash and a short `max-age`: an unchanged image answers `304`
without resending bytes. We considered redirecting to `/assets/<hash>` to keep
immutable caching on the payload, and rejected it: the redirect still has to
resolve the id, so it buys only the byte transfer, at the cost of a second hop
on every image.

The daemon cannot infer which object holds assets, because that is project data,
so **the config nominates one object** for body image URLs to resolve against.
`loadConfig` checks that it exists and carries an image property. This is a
pointer, not a shape: the object stays entirely the project's, with whatever
fields it wants. We are still not shipping an asset object.

**In-body images require that object to be configured, and asking for them
without one is a load error.** A `markdown` property opts in to images; if any
does while no asset object is named, `loadConfig` refuses the config and says to
define one, linking the documentation. The alternative, an editor that quietly
lacks a button, is the failure mode this project keeps meeting: config that
loads and then behaves unexpectedly (ADR 7).

**The `image` property is deliberately not gated.** An asset object is an
ordinary object with an `image` property, so requiring an asset object to use
`image` would make it require itself. Uploading bytes into a field stays a blob
layer concern, available to any project, and that is what lets an asset object
be defined at all.

**The two URLs belong to different layers.** `/assets/<id>` is the only form
that appears in content. `/assets/<hash>` remains exactly as it was, as the blob
route: the `image` property renders from it, and it is the only asset URL that
can be cached forever. It cannot be removed, because an asset object is itself
an object with an `image` property. Bodies written before this change keep resolving, a migration rewrites
them, and any that survive stay valid indefinitely because blobs are never
collected.

## Consequences

- Replacing a file reaches prose as well as attachments, which is the point.
- A body maps to exactly one asset, so usage attribution and render-time alt and
  credit stop being guesses.
- **A stored body is no longer self-resolving outside its database.** A hash
  meant something anywhere the blob store existed; an id does not. This
  contradicts an explicit sprintster-cms requirement and they have to agree to
  it.
- **In-body images become a configured feature rather than an inherent one.**
  That changes behaviour we shipped, though with no project in production yet it
  costs only documentation.
- `loadConfig` gains its first message that links documentation. The rest name
  the offender and say what to do without a link, so this is a new convention
  and will look inconsistent until the others follow.
- The blob route stays free of object knowledge, but the engine now holds a
  config-level notion of which object body images resolve against, which is a
  coupling we had previously refused.
- Two URL forms exist until the migration has run everywhere.
- An asset's current hash is already readable through the object route, since it
  sits in the record's `image` property. No separate endpoint is needed unless
  something wants it without knowing the object's name.
