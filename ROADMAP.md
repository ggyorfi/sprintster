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

## Epic: run on Cloudflare

**Goal.** One sprintster app deploys to a Cloudflare account, the free plan
included, with the same config, the same HTTP API and the same web GUI it has
under Node.

**Why.** A Node host plus a database is the biggest cost of running a small app.
A Durable Object with SQLite storage and R2 for blobs is close to zero for one
app, and on Cloudflare the Durable Object also gives each app its own database.

**Why it is cheap.** The engine has no Node-only imports, and storage already
sits behind `EventStore` (`engine/src/events/store.ts:29`) and `BlobStore`
(`engine/src/blobs/store.ts:12`). The Durable Object SQL API (`sql.exec`) is
synchronous, like better-sqlite3, so the new store follows `storage-sqlite`
closely. The daemon is a Hono app, and Hono runs on Workers.

**What is in the way.** Verified in the code:

- `daemon/src/app.ts:2` imports `serveStatic` from `@hono/node-server` at the
  top level, for the web GUI. Bundling the daemon for Workers pulls in Node
  modules even when no GUI is served.
- `appConfig` is a module-level global set once at boot
  (`engine/src/config/app-config.ts:7`). That is fine for one app per Worker.
  It rules out more than one app in one isolate.
- Listing an object folds every event of its type on every request
  (`engine/src/entity-api/factory.ts:51`), so the cost grows with total event
  bytes, not with record count. Measured 2026-10-31 with 5 KB bodies: 500
  records of 10 events each cost 62 ms of CPU in Node and 63 ms inside a
  Durable Object on a free account, against a documented free-plan limit of
  10 ms. The free account let it through, but nothing documents how far over
  the limit it will go, so we do not build on it. One record read costs
  0.06 ms.

**Scope.** Single tenant only: one Worker and one Durable Object per app.
Hosting many apps on one deployment is a separate, private product built on
these packages. Only engine changes that are generic and useful outside it
land here, the per-app config below being the likely one.

### Steps

- [x] **1. Daemon free of Node at import.** The static handler for the web GUI
      is passed in through `AppDeps` instead of imported, and the Node runtime in
      `cli/src/runtime.ts` supplies it.
      *Done when:* `@sprintster/daemon` bundles for the Workers runtime with no
      Node built-ins, and the Node daemon still serves the GUI.

- [x] **2. Shared store contract tests.** One suite,
      `describeEventStore` in `@sprintster/engine/testing`, run against every
      `EventStore`: in memory and sqlite today, the Durable Object store when it
      exists. Postgres is left out until something deploys on it, since its
      only test checks the shape of the store object and running it for real
      needs a server (or PGlite, which cannot show concurrent connections).
      *Done when:* the in memory and sqlite stores pass the shared suite and
      their duplicated cases are gone.

- [x] **3. Current-state table.** After 2. Each record's folded state is
      stored in a table of its own, written in the same transaction as the event
      that changed it, and every read (one record or a list) comes from that
      table instead of folding the log. The log stays the source of truth: the
      table is derived, and `s8r rebuild-states` rebuilds it from the log,
      the same rule as the reference index below. The engine computes the
      state, since only it holds the reducer, and the store writes both
      atomically. A store opts in through `EventStore.states`; postgres does
      not yet and keeps folding. States that are missing or behind the log are
      rebuilt on the first read of each object, which is how existing data
      upgrades.
      *Done when:* listing 500 records of 10 events each costs about what 500
      records of one event cost today (5 ms in Node rather than 62 ms); both
      existing stores pass the shared suite with the table in place; and a
      rebuild over a populated store yields the same states as the fold.
      Measured 2026-11-01: 3.2 ms, and the reference site's data upgraded on
      first read to states identical to the fold for all seven objects.

- [x] **4. Durable Object event store.** After 3. `createDurableObjectEventStore`
      in `@sprintster/storage-cloudflare`, implementing `EventStore` and its
      states over the Durable Object SQL API, with the same DDL as sqlite.
      *Done when:* it passes the shared suite inside the Workers runtime.

- [x] **5. R2 blob store.** `createR2BlobStore` in the same package, keyed by
      hash. `BlobStore` gained a shared suite of its own, `describeBlobStore`,
      which the filesystem and in memory stores now run too.
      *Done when:* a second put of the same bytes stores nothing new, and the
      content type survives a round trip.

- [x] **6. Worker entry and deploy.** After 1, 4 and 5. `createWorker` in
      `@sprintster/cloudflare`, published as `sprintster/cloudflare`: a Durable
      Object running the daemon's app over the two stores, and a Worker that
      routes to it. The web GUI is served as Workers static assets, and
      [docs/cloudflare.md](./docs/cloudflare.md) is the deploy path: two files
      in the project, two wrangler commands.
      *Done when:* a fresh scaffold deploys to a free account, and the GUI and
      API work at its `workers.dev` URL. Deployed 2026-11-01 with the
      reference site's config: API, writes, R2 upload and download, and the
      GUI with its assets all answered, then the Worker and bucket were
      deleted.

### Still open

- **The CLI and TUI.** Whether they stay local and point at the deployed URL,
  and how they authenticate there. A deployed app now takes one user and
  password from Worker secrets and checks them as Basic Auth in the Worker,
  before the Durable Object; `/health` stays open. Per-user accounts are not decided.
  The local daemon still has no auth, which is acceptable on `127.0.0.1`.
- **Free plan limits.** 100,000 rows written per day, and a per-object storage
  cap that Cloudflare's own docs give as 1 GB in one place and 10 GB in another.
  Each write becomes two rows once step 3 lands, the event and the state, so
  the daily write allowance halves. Check the current numbers before promising
  anything about free use.
- **Lists that grow by record count.** Step 3 removes the cost of edits, not of
  records: 500 records of one event each still cost about 5 ms, most of it
  full bodies a list view does not show. Lists that return only the fields
  they ask for would cut that, and are not planned until a project needs them.
- **Per-app config.** Replacing the `appConfig` global with config passed per
  app. Not needed for single tenant, and a prerequisite for any multi-app host.
  Whether it lands here depends on whether multi-app hosts share one config.

---

## Epic: plugin routes and GUI extensions

**Goal.** A package adds routes, a button and a status badge to any app through
its `plugins` config, and can ask what changed since a point it remembers. The
first user is sprintster-cms publishing: the engine gains the extension points,
not the feature. Design: [ADR 13](./docs/ADR/0013-plugin-routes-and-declarative-gui-extensions.md).

### Steps

- [x] **1. Load plugins in every host.** The daemon and CLI call
      `loadPlugins` for the config's `plugins`; `createWorker` takes the modules
      explicitly; the TUI and web GUI read what plugins add from `/config`.
      *Done when:* a test plugin's object appears in each host, and a Worker
      whose config names a plugin it was not given refuses to start.
- [x] **2. Plugin routes.** `ctx.routes.register` mounts handlers at
      `/plugins/<namespace>/`, behind the same auth; `plugins` is reserved.
      *Done when:* a plugin route answers on Node and in the Worker, and an
      object routed `plugins` is rejected by `loadConfig`.
- [x] **3. The log position.** `EventStore.position()` in all four stores,
      covered by the shared contract suite; `GET /log?since=`.
      *Done when:* the position grows with every append in every store, and
      `/log` lists exactly the changes after the given position.
- [x] **4. Actions and badges.** `ctx.gui.action` and `ctx.gui.badge`, listed
      in `/config` under `extensions`, rendered by the web GUI and the TUI.
      *Done when:* pressing an action POSTs to its route and shows the reply,
      and a badge refreshes on its interval and after any action.

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
- **Collecting unreferenced blobs.** Nothing removes a blob that no record
  points at any more, and a replaced image leaves its predecessor behind. A
  collector is downstream of step 3, which is why the target there is an id
  *or a blob hash*: reachability has to be computed over every property of
  every object, since content addressing means an unrelated record may share
  the same bytes with nothing to signal it. Two things to settle before
  building one. Whether reachability means the current fold or every version in
  history, since collecting on the current fold makes a replacement
  irreversible and breaks stored URLs. And that a collected blob can no longer
  be re-derived, so anything rebuilt from source after a collection is not
  reproducible.

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

- [x] **2. Visual ref picker.** Shipped before 1, from the existing
      thumbnail rule (an image property, or the first image behind the list's
      thumbnail ref column): cards with drag and arrow reordering, a dialog
      grid with search (`web/src/ui/RefCards.tsx`). When a `ref` or `refs` target carries
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

- [ ] **5. Insert an existing record into a body.** After 2. On a markdown
      property with images enabled, the author can insert a reference to a
      record that already exists, not only upload a new file.
      *Done when:* inserting from the picker writes a reference to the chosen
      record and creates no new record, the same record can be inserted twice in
      one body, and upload on drop still works unchanged.

### Still open

- **What a grid card shows** beyond the thumbnail, and how much of that is
  config rather than convention. Worth designing against a real config before
  committing to schema.
- **Whether "create the target inline" needs its own view config**, or can
  derive its form from the target's existing create view.
- **Whether records should also dedup by content hash**, so two uploads of one
  file share a record rather than sharing only the blob. Not while removal
  cannot say what a record is used for: sharing a blob is invisible and
  harmless, sharing a record is invisible and not. Revisit after the reference
  index.

## Epic: login screen

**Goal.** An app whose host provides auth gets a login screen, a logout button
and silent session renewal in the web GUI, while the engine never checks a
password. Design: [ADR 14](./docs/ADR/0014-login-screen-for-a-host-provided-auth.md).

### Steps

- [x] **1. Config.** Optional `auth: { login, logout, refresh }`, each a path
      whose first segment is not a daemon route, checked in `loadConfig`;
      `/health` reports it.
      *Done when:* a path shadowed by an object route is rejected, and `/health`
      returns `auth` only when it is set.
- [x] **2. The web GUI.** A login screen on 401, one shared refresh and retry
      before it, a logout button, state reloaded after login.
      *Done when:* two concurrent 401s cause one refresh call, and a failed
      refresh shows the login screen.

---

## Epic: public plugin routes and plugin secrets

**Goal.** A plugin can take requests from outside the admin, such as a payment
provider's webhook or a public form, and read the keys it needs, without the
engine knowing what the plugin is for. The first user is a shop's payment
plugin (Stripe checkout and webhook), but nothing here is about payments.
Design: [ADR 16](./docs/ADR/0016-public-plugin-routes-and-plugin-secrets.md).


Today every plugin route sits behind the API's auth (`docs/plugins.md`, "A
daemon plugin") and the plugin context carries no secrets
(`engine/src/plugin/types.ts`).

### Steps

- [x] **1. ADR 16.** How a route declares itself public, how hosts that wrap
      the daemon learn which paths are public, and how a plugin names and
      receives its secrets.
      *Done when:* the ADR is accepted and the open questions below are
      answered in it.
- [x] **2. Public routes.** A manifest's `publicRoutes`; `createWorker`
      returns `isPublic`, which its Basic Auth applies and a wrapping gate
      takes. The Node daemon has no auth, so nothing changes there; the plugin
      checks the request itself.
      *Done when:* a public route answers without credentials in the Worker,
      and a non-public route of the same plugin still returns 401.
- [x] **3. Secrets.** A plugin declares the secret names it needs and reads
      them from `ctx.secrets`: Worker secrets on Cloudflare, environment
      variables on Node.
      *Done when:* a plugin reads a declared secret on both hosts, an
      undeclared name is not readable, and a missing declared secret stops the
      host from starting with an error naming it.

### Still open

- **Rate limiting** of public routes: the plugin's job, the host's, or
  Cloudflare's rules in front of both.

## Epic: erasing records from the log

**Goal.** Code can remove a record, or some of its fields, from storage for
good: personal data past a retention limit, short-lived records past their
use. Design: [ADR 18](./docs/ADR/0018-erasing-records-from-the-log.md).

### Steps

- [x] **1. Store primitive.** `EventStore.rewriteStreams` in every store
      (memory, SQLite with `secure_delete`, Postgres, Durable Object), in the
      shared contract tests.
      *Done when:* each store deletes or rewrites a stream in one transaction,
      the position still grows, and a moved head changes nothing.
- [x] **2. `erase` and `redact`** on the object API and to plugins, with the
      unique claims of the values, reported by `changesSince`.
      *Done when:* after an erase no event in the log holds the record's
      values, and the values are free for another record.

### Still open

- **Retention of exports and backups**: copies made before an erase keep the
  data; a Durable Object keeps 30 days of recovery history.

## Epic: PDF documents as assets

**Goal.** An app keeps its PDFs (a report, a proposal) with the rest of its
content, and prose links to them the way it embeds images. Design:
[ADR 19](./docs/ADR/0019-pdf-documents-as-assets.md).

### Steps

- [x] **1. Uploads and serving.** `application/pdf` sniffed and accepted; every
      non-image blob served with `Content-Disposition: attachment`.
      *Done when:* a PDF uploads by its bytes and downloads from both asset
      routes, and an image still opens inline.
- [x] **2. `file` property.** Holds an image or a PDF; `image` refuses a PDF.
      The assets object may hold its file in either.
      *Done when:* both value schemas, `loadConfig` and every switch over
      property types handle it.
- [x] **3. Document links.** `documents: true` on a markdown property gives the
      web editor a button that uploads a PDF and inserts
      `[name](/assets/<id>)`; `loadConfig` refuses it without a `file` assets
      object.
      *Done when:* an inserted link is stored root-relative.

## Epic: who changed what, and what was published

**Goal.** The log records the real user behind each change, a consumer can
read records as they were at a log position, and a plugin can put an action
or a status on a single record. Together they let a site generator publish
one approved record at a time. Design:
[ADR 20](./docs/ADR/0020-the-actor-comes-from-the-host.md),
[ADR 21](./docs/ADR/0021-reading-records-as-of-a-log-position.md),
[ADR 22](./docs/ADR/0022-record-actions-and-badges.md).

### Steps

- [x] **1. The actor from the host.** The daemon writes with the
      `Sprintster-Actor` header; `createWorker` strips it, sets it from Basic
      Auth, and keeps a wrapping gate's with `trustActor`; `changesSince`
      reports the actor.
      *Done when:* a write through the Worker with Basic Auth records the user
      name, and a client's own header is ignored.
- [x] **2. `listAt`.** On the object API and to plugins, plus
      `GET /<route>?at=`.
      *Done when:* a record edited after a position reads as before the edit,
      one created after it is absent, and a per-record position wins.
- [x] **3. Record actions and badges.** `placement: 'record'` with `objects`,
      in the web dialog and the TUI record screen.
      *Done when:* an action posts `{ object, id }` and shows its message, and
      a badge loads with the record.

## Epic: any file as a download

**Goal.** An app that opts in keeps files of any type, up to its own size
limit, and a public site serves them from the blob store. Design:
[ADR 23](./docs/ADR/0023-any-file-as-a-download.md).

### Steps

- [x] **1. `uploads` config.** `anyFile` and `maxMegabytes`, enforced on
      upload, the type from the bytes or the extension table.
      *Done when:* a `.doc` uploads with `anyFile` and is refused without it,
      and the limit follows `maxMegabytes`.
- [x] **2. `blobResponse`.** Exported from the daemon and `sprintster/cloudflare`,
      used by its asset routes.
      *Done when:* the asset route tests pass through it, with a file name
      in `Content-Disposition`.

## Epic: paged lists from the store

**Goal.** No list request reads or sends more than one page, inside the store,
the daemon or the network. Design:
[ADR 24](./docs/ADR/0024-paged-lists-from-the-server.md).

### Steps

- [x] **1. Query contract.** The query type (`q`, `sort`, `fields`, `list`,
      `limit` 50/100, `offset` or `after`), the search text normalizer (case and
      accents), list config `sort` checked by `loadConfig`, and the shared store
      contract tests, passing on the in-memory store.
      *Done when:* the contract covers search, sort, ref columns, offset and
      cursor paging, and the in-memory store passes it.
- [x] **2. SQLite.** The search column, written with the state; `query` in SQL
      with ref joins and keyset cursors; states rebuilt with the column.
      *Done when:* the contract passes, and a page of 100 from 5,000 records
      reads only those rows.
- [x] **3. Postgres.** The same.
      *Done when:* the contract passes against Postgres.
- [x] **4. Durable Object.** The same, in its SQLite.
      *Done when:* the contract passes in the Workers test runner.
- [x] **5. `GET /<route>` and the API client.** Paged answers only, plugin
      columns per page, `listAll` following the cursor.
      *Done when:* no request answers more than 100 rows.
- [x] **6. Web.** The list pages on scroll and renders only rows in view; ref
      labels from `fields`; pickers and cards search on the server.
      *Done when:* the tanarblog articles list opens with one small page and no
      frontend lists a whole target object.
- [x] **7. TUI.** Pages ahead of its window, server search, ref labels from
      `fields`.
      *Done when:* the TUI lists the tanarblog articles one page at a time.
- [x] **8. Other callers.** `s8r migrate-assets` and the tenant scripts through
      `listAll`.
      *Done when:* nothing in core, cms or tenants reads a whole object in one
      request.

## Epic: pinned snapshots

**Goal.** A chosen version of each record is stored once and read like any
state, page by page, with a change feed. Design:
[ADR 26](./docs/ADR/0026-pinned-snapshots.md). After the paged lists, whose
query it reuses.

### Steps

- [x] **1. Contract.** `pin`, `unpin`, `queryPinned`, `pinnedSince`, the pin
      sequence, erasure and rebuild, in the shared store contract tests.
      *Done when:* the in-memory store passes them.
- [x] **2. SQLite, Postgres, Durable Object.** Natively, like `query`.
      *Done when:* every store passes the contract.
- [x] **3. To plugins.** `ctx.data` offers them.
      *Done when:* a plugin pins, queries and follows changes.

## Epic: plugin list columns and action inputs

**Goal.** A plugin shows per-record state in lists and offers row actions that
take one value. Design:
[ADR 25](./docs/ADR/0025-plugin-list-columns-and-action-inputs.md). Before
the paged-lists epic; the columns move to each page when lists are paged.

### Steps

- [x] **1. Columns.** `ctx.gui.column`, called per list response, pills in the
      web list (the TUI later).
      *Done when:* a column's values arrive with the list and show coloured.
- [x] **2. Row actions.** `inList` and `disabledWhen` on record actions.
      *Done when:* a disabled row button follows its column's value.
- [x] **3. Inputs.** `input: { type: 'datetime' }` dialog, posting `value`.
      *Done when:* an action posts a picked date, or null when left empty.

## Epic: list filters

**Goal.** A list narrows to a kind of record by named options, applied in the
store with the search and paging. Design:
[ADR 27](./docs/ADR/0027-list-filters.md).

### Steps

- [x] **1. Config and query.** `filters` groups of named options
      (`equals`, `notEquals`, `startsWith`, `notStartsWith` on a property path),
      checked by `loadConfig`; `StateQuery.where` in all four stores, in the
      shared contract; `?filter=<group>:<option>` resolved by name.
      *Done when:* every store gives the same answers, and an unknown name is a 400.
- [x] **2. Frontends.** A switch per group in the web list; `f` cycles the
      first group in the TUI.
      *Done when:* choosing an option restarts the list from its first page.

## Epic: reads that do not grow with idle clients

**Goal.** An open admin page costs no Durable Object reads while nothing
changes, and the reads that remain do not grow with the data. Design:
[ADR 28](./docs/ADR/0028-reads-that-do-not-grow-with-idle-clients.md).

### Steps

- [x] **1. Live log.** `/log/live` pushes the position after a write; `watchLog`
      reconnects with backoff; the web GUI and TUI reload badges on it, a hidden
      tab holds; badge `refresh` and the `/health` ping are gone.
      *Done when:* an idle tab sends no requests.
- [x] **2. Verified states.** `statesVerified` before `statesStale`'s scan, in
      all four stores.
      *Done when:* a woken host's first read of a type reads two rows.
- [x] **3. Kept counts and the default order.** `state_meta` counts kept with
      each state write; `states_created` index; descending sort without the
      `IS NULL` term.
      *Done when:* a default list page reads its own rows, held to the same
      totals by the shared contract.
- [x] **4. Plugin keep.** `PluginData.keep`, in the Durable Object only.
      *Done when:* a plugin's derived state survives hibernation.

### Still open

- Paging deep into a list with the `after` cursor still scans the rows before
  it; only a user scrolling pays for that.
