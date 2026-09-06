# 12. The web GUI is mountable under any base path

Date: 2026-09-06

## Status

Accepted.

## Context

The built web GUI is served by the daemon at its root, and the bundle assumed
as much: Vite emitted absolute `/_app/...` asset URLs, and `resolveApiBaseUrl`
fell back to `''`, so every request went to `/health`, `/config` and the object
routes at the origin root.

That broke the first time a host put the admin somewhere else. sprintster-cms
serves a site at `/` and proxies the admin under `/admin`: the shell and the
bundle loaded, then the bundle called `/config` at the site root and got the
site's 404 page back. The host was bridging `/_app/*` by hand and still could
not make the API calls follow.

`VITE_API_URL` exists for the case where the API is on another origin. It is
a build-time value, so it cannot describe where one build ends up mounted.

## Decision

**The bundle works under any mount point, and every URL it builds follows that
mount point.** Nothing is configured and nothing is injected by the host.

- Vite builds with `base: './'`, so the shell references its bundle relatively.
- The bundle discovers its mount point from its own script URL: everything
  before `/_app/` is the app root (`appRootFrom`). The API base defaults to that
  root, so hosted at `https://x/admin/` the bundle calls
  `https://x/admin/config`; hosted by the daemon at `/` it calls `/config` as
  before.
- Asset previews go through the same base in both directions. `assetUrl` and
  `displayedAssetUrl` prefix it, `storedAssetUrl` strips it, so content keeps
  its root-relative `/assets/<id>` form ([ADR 10](./0010-body-images-reference-the-asset-record.md))
  and a body authored under one mount point loads under another.
- `VITE_API_URL` keeps its meaning: an explicit API location, for the Vite dev
  proxy and for a build whose API is genuinely on a different origin. When set
  it wins.

The host's side of the contract is two rules: serve the shell at the mount
path with a trailing slash, and forward everything under that path to the
daemon with the prefix stripped. The daemon needs no change.

## Consequences

- A host such as sprintster-cms needs no `/_app` bridge and no knowledge of the
  bundle's layout beyond the prefix it chose.
- The admin's own routing stays on `?ctx=`, which is why the mount path is the
  only path it ever occupies. If it moves to path routing later, it has to keep
  resolving URLs from the bundle's root rather than the document, which this
  decision already provides.
- The bundle and the shell must be served from the same origin for discovery
  to work; splitting them is the `VITE_API_URL` case.
