# 15. Config files can extend a shared one

Date: 2026-11-04

## Status

Accepted.

## Context

Several projects can run the same app with small differences: one schema, one
set of views, but a different title, default language or port. Copying the
config into each project lets the copies drift apart, and every fix has to be
made once per copy. Generating the files from a template moves the problem to
the generator.

## Decision

**A project config may name a file it extends.** `"extends": "<path>"` at the
top level of `sprintster.config.json`, relative to the file that declares it.
The chain may go on, and a cycle is an error.

**Merging follows tsconfig.** Plain objects merge key by key; anything else,
arrays included, is replaced by the extending file's value. So a project can
set `app.title` or `app.locales` and keep the shared `app.objects`, but
changing one object means repeating the whole `objects` list. Nothing finer is
needed yet.

**Two functions, one rule.** The engine exports the pure
`extendConfig(base, site)`, which runs anywhere, the Worker included. The Node
side reads files with `readConfigFile(path, rebase)`, which follows the chain
and merges with `extendConfig`; `rebase` names top-level keys whose `./` or
`../` values are paths, made absolute against the file that declares them. The
engine config has no such keys today; tools reading their own files with it
can name theirs.

A Worker bundles its config as an import, with no file system to follow
`extends`, so it imports both files and calls `extendConfig` itself.

## Consequences

- Every tool reading a project config goes through `readConfigFile`, or it
  sees only the extending file.
- `environments` hold paths resolved at run time against the project, not the
  file. They belong in each project's own file, never the shared one.
- The merged result is validated as before, so a shared file alone may be
  incomplete.
