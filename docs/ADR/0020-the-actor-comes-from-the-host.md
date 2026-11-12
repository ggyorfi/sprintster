# 20. The actor comes from the host

Date: 2026-11-12

## Status

Accepted.

## Context

Every event carries an `actor`, and the object API takes one on each write,
but the daemon never passes it: every write through HTTP is recorded as
`system`. An app with several editors cannot tell who changed what, and a
plugin cannot act on "my changes".

The engine never checks a password (ADR 14). Whoever authenticates the
request is the host in front of the daemon: Basic Auth in `createWorker`, or a
gate wrapping it.

## Decision

**The daemon reads the actor from the `Sprintster-Actor` request header** and
passes it to every write it makes for that request: object writes, commands,
singleton saves and blob uploads. Without the header the actor stays `system`.

**Whoever authenticates sets the header, and every host strips a client's
copy.**

- `createWorker` removes the header from every incoming request. With its
  Basic Auth on, it sets the header to the verified user name.
- A gate that wraps `createWorker` passes `trustActor: true` to it, removes
  the header itself, and sets it after its own check (`tenants/auth` sets the
  session's or the Basic credentials' user name).
- The daemon only reads the header when its host says it may
  (`createApp({ trustActor: true })`). `createWorker` says so; the Node daemon
  has no authentication and does not, so every write there stays `system`.

## Consequences

- The log records who made each change, and `changesSince` reports it, so a
  plugin can show or filter by it.
- A host that forwards requests without stripping the header would let a
  client claim any name. The two hosts we ship strip it; a new host must too.
- Plugin routes write through `ctx.data` and keep passing their own actor, as
  before.
