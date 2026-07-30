# Roadmap

Work we have decided to do, and why. This is not a changelog and not a wish
list: an item lands here once we agree it should be built, and leaves when it
ships. The reference docs in [`docs/`](./docs/) describe what exists today;
this file describes what does not exist yet.

Each step states what "done" means, so it can be closed on evidence rather than
on judgement. Where a step rests on something we have verified, the file and
line are cited. Where it rests on a design we have not built yet, it says so.

Steps are checkboxes. Tick one when it ships, in the same commit as the work, so
the file says what is actually done rather than what was planned. A step still
carrying a tag (`in progress`, `blocked`, `open question`) needs something other
than time before it can be ticked.

Shipped and removed from this file: image handling in the markdown widgets. Its
decisions are recorded in
[ADR 9](./docs/ADR/0009-asset-and-image-handling.md), the authoring contract in
[objects and properties](./docs/objects-and-properties.md#images-in-a-markdown-body).

---

## What we are not building

The sprintster-cms team asked for an asset object layer over the blob store: a
media library, with assets carrying their own title, alt, credit and licence.

We are not building an asset object, in the engine or as a plugin. Not every
application wants a media library, and the ones that do will not want the same
one, so anything asset-shaped in the engine would be wrong for somebody.

We also found we do not need to. An asset is an ordinary config-defined object
with an `image` property and whatever other fields a project wants. The defect
in `image` was never the type: it is that used inline on a post, the metadata is
copied per record, so two posts using one picture hold two independent alt
texts. Used as a field on an object of its own, the same type holds that
metadata exactly once. `ref` and `refs` to that object already work, and so does
referential integrity.

One qualification, added after we decided that body images reference the asset
record ([ADR 10](./docs/ADR/0010-body-images-reference-the-asset-record.md)):
the engine does acquire a config-level pointer naming which object body image
URLs resolve against. That is a pointer, not a shape, and the object stays
entirely the project's. It is still a coupling we had refused, so it is written
down here rather than glossed.

So the project declares the asset object; we supply capabilities that are not
about assets at all:

| they described | what it actually is |
|---|---|
| media library screen | a list display mode with thumbnails |
| asset picker | a ref picker for targets that carry an image |
| upload inside the picker | create the target record inline |
| bulk upload | create many records from many files |
| where is this used | reverse references, for every object |

Each is worth having for products, people and venues as much as for pictures.
That is also the discipline this rests on: any capability that only makes sense
for an asset library should be refused rather than generalised, or we pay a
generality tax for a single user.

Plugins keep a job here, just not this one. An alternative asset *backend*, S3
or Cloudinary behind `PluginObjectApi`, fits the existing mechanism. The UI does
not: plugin contexts reach the daemon, CLI and TUI
(`engine/src/plugin/types.ts:52-70`) and there is no web registry.

---

## Epic: body images reference the asset record

**Goal.** Replacing the file behind a picture updates prose as well as
attachments, and a body image names exactly one record.

**Why.** See [ADR 10](./docs/ADR/0010-body-images-reference-the-asset-record.md).
A body holding a blob hash points at bytes, so a replacement reaches every `ref`
and `refs` attachment and silently misses prose, and when two records hold one
blob a body cannot say which it meant.

**What it costs.** A stored body stops being self-resolving outside its
database: a hash meant something anywhere the blob store existed, an id does
not. That contradicts an explicit sprintster-cms requirement and they have to
agree to it. The image button also becomes opt-in rather than implicit, which
changes behaviour we shipped; with no project in production yet that costs
nothing but the documentation.

**Nothing degrades silently.** A config that asks for in-body images without an
asset object is a load error, not an editor that quietly lacks a button. The
`image` property is deliberately not gated this way: an asset object *is* an
ordinary object with an `image` property, so gating it would make it require
itself. Uploading bytes into a field needs no asset object, and that is what
lets you define one.

**One form in content, one at the transport layer.** After step 4 the only asset
URL that appears in stored content is `/assets/<id>`. `/assets/<hash>` remains,
untouched, as the content-addressed route: it is what the `image` property
renders from (`web/src/ui/ImageField.tsx:81`), and the only URL that can be
cached forever, which is not
removable because an asset object is itself an object with an `image` property.
A legacy hash URL in an old body keeps resolving indefinitely, since blobs are
never collected, so we tolerate them and never emit them.

### Steps

- [x] **1. Config names the asset object, and images are opt in.** A top-level
      declaration naming which object body image URLs resolve against, and an
      `images` flag on a `markdown` property, off by default. `loadConfig`
      rejects a named object that does not exist or carries no image property,
      and rejects any property asking for images while no asset object is
      named.
      *Done when:* each of those three bad configs fails to load with a message
      naming the offender, saying what to define, and linking the assets section
      of the docs; that docs section exists; and a config that asks for neither
      loads unchanged.

- [x] **2. Serve an asset URL.** After 1. `GET /assets/<id>` serves the blob
      that record currently holds. The response cannot be `immutable`, since the
      point is that it changes, so it carries `ETag` set to the content hash and
      a short `max-age`: an unchanged image answers `304` without resending
      bytes, and a replacement is picked up on the next revalidation.
      *Done when:* it serves the current blob, follows a replacement, answers
      `304` to a matching `If-None-Match`, 404s for an unknown or removed
      record, and the existing `SHA256` guard still lets static files under
      `/assets` fall through. `HEAD` answers the same `ETag` with no body: a
      generator uses it to learn an asset's current hash without downloading it,
      then caches the bytes under the `immutable` `/assets/<hash>` URL.

- [x] **3. Insert creates an asset.** After 2. On a markdown property that asks
      for images, the button, paste and drop upload the blob, create the asset
      record, and write `![](/assets/<id>)`.
      *Done when:* inserting produces an asset reference and a record carrying
      the blob; on a property that did not ask for images there is no button and
      a pasted image falls through to the editor rather than failing.

- [x] **4. Migrate existing bodies.** After 3. A documented command rewriting
      `/assets/<hash>` in stored markdown to the asset reference, where a record
      holds those bytes.
      *Done when:* running it twice is the same as running it once, a body whose
      hash no record holds is left alone and reported, and the rewrite is a
      normal event rather than an edit behind the log.

---

## Epic: reference index and safe removal

**Goal.** Answer "what references this?" as an indexed read rather than a scan,
for every object, and refuse to remove something while the answer is not empty.

**Why.** `findBacklinks` (`engine/src/engine/backlinks.ts:43`) already answers
the question for `ref` and `refs`, but by loading every row of every referencing
object. That is acceptable behind a detail panel and far too slow as a guard on
every removal or behind a library screen. It also cannot see in-body images at
all, since those live as a URL inside a markdown string rather than in a `ref`
field.

**Why it is hard.** State is folded from events on read
(`engine/src/entity-api/factory.ts:40`) and there is no projection layer, so the
reverse direction is a full scan by construction.

### Design

The engine gains one extractor: given a property config and a stored value,
return what it references. An exhaustive switch over `PropertyConfig['type']`
with no `default:` branch, matching `config/compile.ts` and `engine/view.ts`, so
a new property type is a compile error until it declares its stance. `ref` and
`refs` yield target ids, `markdown`, `text` and `code` yield the asset ids in the
`/assets/<id>` URLs they contain, `image` yields its blob hash, and most types
yield nothing.

On write, the object write path derives what a record referenced before and
after the change, and appends `Referenced` and `Dereferenced` facts to a stream
keyed by the referenced thing, the way `BlobUploaded` is keyed by hash
(`engine/src/blobs/api.ts:6`). The query is then a single `findByStream` folded
to the current referrer set: one indexed read against
`UNIQUE (partition_id, stream_type, stream_id, stream_version)`
(`storage-sqlite/src/store.ts:23`).

### Decisions

**A body image is an ordinary reference.** Since bodies carry the asset id, the
extractor reads `/assets/<id>` out of markdown and yields a target id, exactly
like `ref` does. No hash matching, and no ambiguity about which record a body
meant. Legacy `/assets/<hash>` bodies are resolvable but are not references, and
stop existing once the migration has run.

**A reference identifies object, id and property.** So a report can say "cover
of Post X" rather than only "used by Post X". Free at write time, and painful to
add later.

**References are deduplicated per property.** One body using the same image
twice is one reference. The fold stays a set rather than a count.

**The index is derived, not authoritative.** Derived means reconstructible from
the object log, not unstored: we persist it because that is what makes the
lookup indexed. When the extractor is wrong, and it will be at least once, we
rebuild rather than carry corrupt state. Rebuilds are a documented manual
command, and the backfill is the repair tool rather than just the upgrade path.

**Removal is refused while references exist, engine-wide.** Consistent with
`ref` writes already rejecting a removed target: the engine treats removed
records as unreferenceable, so letting one be removed out from under live
references was the inconsistency. This is a **breaking change** for any existing
app that relies on removing a referenced record, and it needs calling out in the
release notes rather than only here.

**Garbage collection stays a non-goal.** Not "not yet": this index cannot answer
the question deletion needs. It reports what references something *now*, while
the event log still holds the hash in older payloads, so replay, audit and
export all touch that history. Deleting blobs is gated on a retention policy for
historical references, not on this index. A view may report that nothing
currently references an asset, as information, and offer no delete.

### Steps

- [ ] **1. Extractor.** The exhaustive `PropertyConfig['type']` switch from a
      stored value to what it references, in the engine.
      *Done when:* covered per property type, including a markdown body with
      several asset references, one referencing the same asset twice, one with
      none, a body still holding a legacy hash URL, and a `refs` field with
      several targets; and adding a property type without handling it fails to
      compile.

- [ ] **2. Reverse index on write.** After 1. Derive the before and after
      reference sets on create, update and remove, and append the difference as
      facts carrying object, id and property.
      *Done when:* creating, editing and removing records leaves the folded
      referrer set correct, including replacing one reference with another,
      editing a body down to no images, and one record referencing the same
      target from two properties.

- [ ] **3. Query API.** After 2. One engine call from a target (id or blob hash)
      to its referrers, and a daemon route exposing it.
      *Done when:* the route answers with referring objects and properties, and
      an empty set for something unreferenced, against a fixture spanning
      `ref`, `refs` and a markdown body.

- [ ] **4. Backfill.** After 2. Existing data carries no index events, and a
      changed extractor needs a rebuild. A documented command, safe to run more
      than once.
      *Done when:* running it twice over a populated store yields the same
      referrer sets as running it once, and running it after an extractor change
      corrects entries written by the old one.

- [ ] **5. Refuse removal while referenced.** After 3. Removal answers `409`
      naming what still points at the record.
      *Done when:* removing a referenced record is refused with its referrers
      listed, removing an unreferenced one still works, and the existing
      soft-delete tests are updated to reflect the new rule rather than worked
      around.

### Still open

- **No exit for a required reference.** Removal is refused while anything points
  at a record, and a non-nullable `ref` cannot be detached, so the only way past
  the guard is repointing or deleting every referrer by hand. A detach flow
  (dropping `refs` elements, nulling nullable refs) or a reassign flow would
  close it, and both are cheap once step 3 can list referrers in one read. We
  are deliberately shipping the guard first and judging from use whether either
  is worth building, rather than designing for a friction we have not felt.
- **The postgres index.** The indexed-read claim rests on the unique constraint,
  which the sqlite adapter creates in its DDL and the postgres adapter does not:
  it assumes an externally managed schema. Before calling the query performant on
  postgres we need to say what that schema must provide.

---

## Epic: visual collection views

**Goal.** Pick, browse and create records that carry an image without a text
typeahead over a display field.

**Why.** `RefPicker` matches on a display string, which is unusable for
pictures, and a list is a table of text. An author who cannot see what they are
picking will paste images into the body instead, which is the friction that made
in-body images the only workable path in the first place.

None of this is asset-specific: a grid of products or of people is the same
capability pointed somewhere else.

### Steps

- [ ] **1. List display mode.** A list may render as a grid of cards with a
      thumbnail drawn from an image property, rather than as a table. Declared
      in config alongside `columns`.
      *Done when:* a list config selects the grid mode and renders thumbnails,
      search and sort still work, and an object with no image property cannot
      declare it (rejected in `loadConfig`, not at render).

- [ ] **2. Visual ref picker.** After 1. When a `ref` or `refs` target carries
      an image, the picker shows thumbnails with search rather than a typeahead.
      *Done when:* picking works from the grid for both `ref` and `refs`,
      `refs` ordering is preserved, and a target with no image falls back to
      today's picker.

- [ ] **3. Create the target inline.** After 2. The picker can create a new
      target record without leaving the record being edited, including
      uploading its file.
      *Done when:* an author attaches a picture that did not exist yet without
      navigating away, the new record satisfies its required fields, and
      cancelling creates nothing.

- [ ] **4. Create many records from many files.** After 3. Multi-select from the
      list view, one record per file.
      *Done when:* selecting several files creates a record for each, a failure
      partway leaves the successful ones created and reports the rest, and
      identical files still produce one blob.

### Still open

- **What a grid card shows** beyond the thumbnail, and how much of that is
  config rather than convention. Worth designing against a real config before
  committing to schema.
- **Whether "create the target inline" needs its own view config**, or can
  derive its form from the target's existing create view.
