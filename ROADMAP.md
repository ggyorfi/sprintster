# Roadmap

Work we have decided to do, and why. This is not a changelog and not a wish
list: an item lands here once we agree it should be built, and leaves when it
ships. The reference docs in [`docs/`](./docs/) describe what exists today;
this file describes what does not exist yet.

Each step states what "done" means, so it can be closed on evidence rather than
on judgement. Where a step rests on something we have verified, the file and
line are cited. Where it rests on a design we have not built yet, it says so.

Status: `agreed` (we will build it), `in progress`, `blocked`, `open question`
(needs a decision before it can start).

---

## Epic: image handling in the widgets

**Goal.** An author can put an image into any content our widgets edit, without
leaving the editor and without knowing what a content hash is, and the image
survives every round trip through both frontends.

**Why now.** The sprintster-cms team cannot exercise their in-body image
pipeline against real content, because nothing in our editors can produce it.
Their build step resolves in-body image references, processes them, and rewrites
the URL, and today it can only be tested against fabricated seed data.

**What we found while scoping it.** The gap is not only a missing affordance.
`MarkdownEditor` (`packages/web/src/ui/MarkdownEditor.tsx:84`) loads
`StarterKit`, which has no image node, so an existing markdown image is
destroyed on edit rather than preserved. Feeding
`Intro\n\n![A blue cover](/assets/abc123)\n\nOutro` to the editor renders no
`img` element at all, and one keystroke serialises the body back as
`Intro\n\nA blue cover\n\nOutro`: the image collapses to its alt text as bare
prose. `ComboEditor` opens in WYSIWYG by default
(`packages/web/src/ui/ComboEditor.tsx:18`), so this happens to an author who
opens a post and edits an unrelated paragraph.

The mechanism, for whoever picks this up: `@tiptap/markdown` registers per-node
handlers by reading `markdownTokenName`, `parseMarkdown` and `renderMarkdown`
off each extension, and its fallback parser handles `paragraph`, `heading`,
`text`, `html`, `escape` and `space` but has no `image` case. An unhandled token
falls to a default branch that descends into the token's children, and for a
marked image token those children are the alt text. Hence the collapse.

That reorders the work: the preservation bug is step 1 and ships on its own,
ahead of any insert UI.

### The rule that governs all of it

**Stored content holds `/assets/<hash>`, root-relative, always.** `assetUrl()`
(`packages/web/src/api/assets.ts:19`) prefixes `resolveApiBaseUrl()`, which is
empty when the daemon hosts the bundle but a full origin whenever `VITE_API_URL`
is set. If that value reaches stored content, bodies authored against a dev
daemon carry `http://127.0.0.1:3030/...` into the database and every page
generated from them points at someone's laptop. Rendering may resolve the URL
however it likes; only the stored string is constrained.

The stored form is plain CommonMark, `![alt](/assets/<hash>)`. Not an HTML
`img`, not a custom node syntax, and no width, height or title metadata encoded
into the URL. Consumers parse bodies with ordinary markdown tooling, and real
dimensions are read from the blob by whoever needs them, consistent with
`readImageSize` already being best-effort
(`packages/web/src/ui/ImageField.tsx:37`).

### Decisions

**The node.** We adopt `@tiptap/extension-image` at 3.28.0. Verified against its
published source: it ships a working `parseMarkdown` (mapping `token.href`,
`token.text` and `token.title` onto the node) and a `renderMarkdown` that emits
exactly `![alt](src)`, or `![alt](src "title")` when a title is set. So the
round trip works without us writing those handlers, which is why step 1 is as
small as it is.

We configure it `inline: false`, `allowBase64: false`, `resize: false`. Only the
last does exactly what its name suggests: width and height attributes exist on
the node but are never serialised, so no dimensions enter the document.

The other two do less than they look like, measured rather than assumed.
`inline: false` does not force an image onto its own line: markdown position is
preserved on a round trip, so an image inside a sentence stays inside it.
`allowBase64: false` only governs the HTML paste rule, so a `data:` URL already
present in markdown parses and round-trips fine. Neither hurts preservation,
where reproducing the author's content is what we want, but it means step 2's
override is the only thing that can keep a `data:` URL out of storage.

**We extend it anyway, to own `renderMarkdown`.** Overriding the serialiser
gives us one choke point where an absolute URL is normalised back to
`/assets/<hash>` before it can reach storage. Enforcing there beats trusting
every upstream path to produce the right thing.

**Title is never authored.** We do not surface it, so it stays null and never
serialises, and output stays the plain `![alt](/assets/<hash>)` the CMS asked
for. We do not strip it either: an imported body that legitimately has one round
trips unchanged.

**The two image paths share a hook, not a widget.** `ImageField` writes
structured JSON into the row and prose writes a bare hash into a string, so the
stored shapes genuinely differ. What they share is the upload call, busy and
error state, and file validation. One hook, two widgets. Without that, step 6's
three failure behaviours get written twice and drift.

**Upload limits are fixed for now.** One sensible limit, enforced server-side so
it also applies to anything talking to the API directly. No new `PropertyConfig`
surface yet; per-property overrides can be added later without a breaking
change.

### Steps

1. **Stop destroying images.** `agreed`. Add the image node so
   `![alt](/assets/<hash>)` parses, renders and serialises unchanged. Ships
   alone, before any insert UI, because it is a correctness fix on existing
   content.
   *Done when:* a test opens a body containing an image, edits unrelated text,
   and asserts the emitted markdown still contains the original image with its
   alt text intact. The test fails against today's editor.

2. **Normalise the URL on serialise.** `agreed`. Extend the node to override
   `renderMarkdown` so a recognised API origin is stripped back to
   `/assets/<hash>`, and decide what it does with a `data:` URL, which the
   node's own `allowBase64` option does not stop on the markdown path.
   *Done when:* with a non-empty API base URL configured, the editor displays
   the image and the serialised markdown still reads `/assets/<hash>`, asserted
   on the stored string rather than on the DOM, including for a node whose `src`
   was set absolute; and a `data:` URL has defined, tested behaviour.

3. **Insert from the toolbar.** `agreed`. A file picker in the WYSIWYG toolbar
   that uploads through the shared hook and inserts at the cursor. Content
   addressing means the same file uploaded twice yields one blob and there is
   nothing to deduplicate.
   *Done when:* an author inserts an image without leaving the editor, and the
   row read back from the API contains the root-relative markdown.

4. **Alt text, authorable in place.** `agreed`. Insert with empty alt (valid
   CommonMark, and correct for decorative images) and let a selected image be
   given alt text in place. We are deliberately not prompting on insert: a modal
   on every paste is hostile, and screenshots are the main case.
   *Done when:* alt text can be set and changed after insert, and round-trips
   through save and reload.

5. **Paste and drag.** `agreed`, after 3 and 4. The same upload path bound to
   paste and drop. Paste is the interaction authors actually reach for.
   *Done when:* pasting an image and dropping a file both produce the same
   markdown as the toolbar path, and pasting the same image twice results in one
   blob.

6. **Failure and limits.** `agreed`. Today `ImageField` surfaces an upload error
   as text (`packages/web/src/ui/ImageField.tsx:116`) and that is the whole
   story. Implement, in the shared hook: what an over-size or wrong-type upload
   does, what the editor shows for a hash whose blob is missing, and whether
   uploads report progress.
   *Done when:* each of those three cases has defined behaviour and a test, and
   the size and type limits are enforced by the daemon rather than only by the
   widgets.

7. **Confirm the lossless paths stay lossless.** `agreed`. Source mode
   (`CodeEditor`) and the TUI edit markdown as text and should preserve images
   for free. We are not building TUI insert: it is a poor fit for a terminal and
   source editing remains available there.
   *Done when:* a test pins that a body with images survives a source-mode and a
   TUI edit unchanged.

---

## Epic: asset reference index

**Goal.** Answer "which objects are using this asset?" as an indexed lookup
rather than a scan, so an asset management UI can show, for any blob, every
object that references it.

**Why.** We want an aggregate view over assets: what we are storing and what is
using it. Every question that view asks is the reverse of the reference
direction we store today, and none of them is currently answerable without
reading everything.

**Why it is hard today.** Nothing indexes the reverse direction, and asset
references are stored in two different shapes:

- an `image` property holds structured JSON in the row, with the hash as a field
- prose holds a bare hash inside a markdown string, as `/assets/<hash>`

The engine has no projection or read-model layer: state is folded from events on
read (`packages/engine/src/entity-api/factory.ts:40`). So answering the question
today means folding every object of every type and inspecting each value, and
for prose it additionally means parsing markdown. That is a full scan per
question, and it gets worse with every object added.

### Design

Maintain the reverse index as events, in the store we already have.

The engine gains one extractor: given a property config and a stored value,
return the asset hashes it references. It is an exhaustive switch over
`PropertyConfig['type']` with no `default:` branch, matching the convention in
`config/compile.ts` and `engine/view.ts`, so every property type we add later is
a compile error until it declares whether it can carry an asset. `image` returns
its hash field; `markdown`, `text` and `code` match `/assets/<64 hex>`; most
types return nothing.

On write, the object write path derives the hashes a record references before
and after the change and appends `AssetReferenced` and `AssetDereferenced` facts
to a stream keyed by the hash, the way `BlobUploaded` is already keyed by hash
(`packages/engine/src/blobs/api.ts:6`).

The query then becomes a single `findByStream(partitionId, '__asset_ref', hash)`
folded to the current referrer set. That is one indexed read: the sqlite schema
carries `UNIQUE (partition_id, stream_type, stream_id, stream_version)`
(`packages/storage-sqlite/src/store.ts:23`), which is exactly the prefix this
lookup needs.

Putting the extractor in the engine rather than in a consumer is the point.
There is then one definition of "an asset reference", shared by both frontends,
by the index, and by anything we later build on it, and our URL shape stays
ours.

### Decisions

**A reference identifies object, id and property.** So the UI can say "cover of
Post X" rather than only "used by Post X". It costs nothing at write time, and
it is the field that is painful to add retrospectively: doing it later means
backfilling already-written events or introducing a second event version.

**References are deduplicated per property.** A body using the same image twice
is one reference. The fold stays a set rather than a count, and editing one of
two occurrences away does not have to decrement anything.

**The index is derived, not authoritative.** Derived means reconstructible from
the object log, not unstored: we still persist it as events, because that is
what makes the lookup indexed. What it buys is that when the extractor is wrong,
and it will be at least once on a new property type or a markdown edge case, we
rebuild rather than carry corrupt state forever. Changing the extractor is then
routine instead of a migration.

**Rebuilds are a documented manual command.** An operator runs the backfill
after an upgrade that changes extraction. That keeps startup predictable, and
the idempotence requirement in step 4 is what makes running it safe. The backfill
is the repair tool, not just the upgrade path.

**Garbage collection is a non-goal.** Not "not yet": the index cannot answer the
question deletion needs. It answers what references an asset *now*. The event log
still contains the hash in older `FieldChanged` payloads, so replay, audit and
export all touch that history, and any future point-in-time read would resolve a
blob we had deleted. There is no such read today
(`packages/engine/src/entity-api/factory.ts:40` folds a stream to head and
nothing else), which is exactly why the constraint is easy to forget.

So deleting blobs is not gated on this index at all. It is gated on a retention
policy for historical references, and on deciding whether an old event may
resolve to a missing blob. Neither is in scope here.

The practical consequence for the UI: it may show that nothing currently
references an asset, because that is a useful signal for spotting a failed
upload or a wrong file, but it presents that as usage information and offers no
delete action. An unreferenced blob is harmless today anyway: `ImageField`'s
Remove already orphans blobs and re-upload is idempotent, so orphans are
bounded.

### Steps

1. **Extractor.** `agreed`. The exhaustive `PropertyConfig['type']` switch from
   a stored value to referenced hashes, in the engine.
   *Done when:* it is covered per property type, including a markdown body with
   several images, one with the same image twice, and one with none, and adding
   a property type without handling it fails to compile.

2. **Reverse index on write.** `agreed`, after 1. Derive the before and after
   hash sets on create, update and remove, and append the difference as facts to
   the hash-keyed stream, each carrying object, id and property.
   *Done when:* creating, editing and removing records leaves the folded
   referrer set correct, including replacing an image with another, editing a
   body down to no images at all, and an asset used by two properties of the
   same record.

3. **Query API.** `agreed`, after 2. One engine call from hash to referring
   objects, and a daemon route exposing it.
   *Done when:* the route answers with the referring objects and properties for
   a hash, and with an empty set for an unreferenced one, against a fixture with
   several object types.

4. **Backfill.** `agreed`, after 2. Existing data has no index events, and a
   changed extractor needs a rebuild. A documented command that walks existing
   records and emits the facts, safe to run more than once.
   *Done when:* running it twice over a populated store yields the same referrer
   sets as running it once, and running it after an extractor change corrects
   entries written by the old one.

5. **Asset management UI.** `open question`, after 3. The aggregate view this
   epic exists to serve.
   *Done when:* scoped. We have not designed it yet, and the payload decided
   above is what it has to work with.

### Still open

- **The postgres index.** The "indexed lookup" claim rests on the unique
  constraint, which the sqlite adapter creates in its DDL but the postgres
  adapter does not: it assumes an externally managed schema. Before we call the
  query performant on postgres, we need to say what that schema must provide.
- **Step 5's scope**, above.
