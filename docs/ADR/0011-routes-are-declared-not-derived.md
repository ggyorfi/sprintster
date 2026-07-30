# 11. Object routes are declared, never derived

Date: 2026-07-30

## Status

Accepted. Narrows the route handling described in
[ADR 7](./0007-semantic-validation-in-loadconfig.md), whose decision about where
semantic validation belongs is unchanged.

## Context

An object's HTTP path used to default to the slug of `titlePlural`, with an
optional `route` to override it.

That made a display label into a URL contract. `title` and `titlePlural` are
strings a project is meant to edit freely; a route is depended on by stored
links, API clients, and now the `/assets/<id>` references inside markdown
bodies. Renaming a heading from "Posts" to "Articles" silently moved `/posts` to
`/articles`, and nothing in the config said that would happen.

## Decision

`route` is required on every object, and nothing derives it. `objectRoute()` is a
field read. `loadConfig` still rejects a route that is not already a slug,
duplicates, and the daemon-reserved `health`, `config` and `assets`.

`slugify` remains exported, but only so a scaffolder can suggest a route from a
label. Nothing at runtime turns a label into a path.

## Consequences

- Renaming a label is safe, and changing a URL is now a deliberate edit.
- Every object carries one more required line. `create-sprintster` writes it, so
  the cost falls on hand-written configs only.
- The "label slugs to nothing" failure is gone, because there is no longer a
  label-to-path step to fail.
- Cloning an object config now copies its route, so a copied object must be given
  its own. That surfaces as a duplicate-route error at load rather than as two
  objects fighting over one mount.
- Every existing config is invalid until each object declares a route. With no
  project in production this costs only the fixtures.
