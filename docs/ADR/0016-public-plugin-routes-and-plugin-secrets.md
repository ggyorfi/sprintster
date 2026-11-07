# 16. Public plugin routes and plugin secrets

Date: 2026-11-07

## Status

Accepted.

## Context

Plugin routes mount at `/plugins/<namespace>/` behind the same auth as the
rest of the API ([ADR 13](./0013-plugin-routes-and-declarative-gui-extensions.md)).
Some plugins must take requests from callers that have no login: a payment
provider's webhook, a public form, a checkout started from a static site.
Those callers prove themselves another way (a signature, a reservation, a rate
limit), and only the plugin knows how.

The same plugins need keys: a payment provider's secret, a webhook signing
secret, a mail service's API key. The plugin context carries `config` and a
logger (`engine/src/plugin/types.ts`), and `config` is app config, stored in
the repo and served in `/config`. A key must never be there.

Auth is checked outside the daemon. The Worker checks Basic Auth before the
request reaches the Durable Object (`cloudflare/src/index.ts`), and a project
may wrap the Worker in its own gate, as a login service does
([ADR 14](./0014-login-screen-for-a-host-provided-auth.md)). Plugin routes are
registered inside the Durable Object, when the plugin's `init` runs, so
neither gate can see them.

## Decision

### Public routes are declared in the manifest

A daemon plugin's manifest gains an optional list:

```js
export const plugin = {
  name: 'my-shop',
  namespace: 'shop',
  publicRoutes: [
    { method: 'GET', path: '/stock' },
    { method: 'POST', path: '/checkout' },
    { method: 'POST', path: '/webhook' },
  ],
  init(ctx) { /* registers the routes as before */ },
};
```

It is static, so a host can read it from the module without running `init`.
Paths use the same syntax as `ctx.routes.register` and are relative to the
plugin's namespace. When plugins load, every declared public route must match
a registered route; one that does not stops the host from starting, so a typo
cannot leave the real route gated and a dead entry public.

`createWorker` returns, next to `App` and `worker`, an
`isPublic(request): boolean` built from the declarations of the plugins it was
given. Its own Basic Auth lets those requests through, and a wrapping gate
takes the same function, so both hosts apply one list. `/health` stays public
as today. Channels and the web GUI's own routes are never public by this
mechanism.

A public route's handler gets the request as it arrived and decides for
itself. The engine does not verify signatures, limit rates or check origins.
Writes it makes through `ctx.data` carry no user; the plugin passes an actor
naming itself (`plugin:<namespace>`).

The Node daemon has no auth of its own, so the list changes nothing there.

### Secrets are declared and handed over by name

The manifest gains an optional `secrets: string[]` of names, and the context a
`secrets: Record<string, string>` holding exactly those:

```js
secrets: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
init(ctx) { const stripe = new Stripe(ctx.secrets.STRIPE_SECRET_KEY, ...); },
```

- On Cloudflare they come from the Worker's secrets, read from the Durable
  Object's `env`. On Node they come from the environment.
- A plugin cannot read a name it did not declare, so a plugin never sees
  another's keys or the host's own.
- Names starting with `SPRINTSTER_` are refused at load: the engine reserves
  them (`SPRINTSTER_USER`, `SPRINTSTER_PASSWORD`).
- A declared secret that is missing or empty stops the host from starting with
  an error naming the plugin and the secret.
- Secrets never appear in `/config`, in logs, or in errors.

Names are not namespaced: two plugins may both declare `RESEND_API_KEY` and
get the same value, as environment variables are shared anyway.

## Consequences

- A plugin author writes the security of each public route. The engine's part
  is a list and a gate check, small enough to review at a glance.
- Rate limiting of public routes is not decided here. Cloudflare rules in front
  of the Worker or the plugin itself can do it; neither needs the engine.
- A project wrapping the Worker passes one more option to its gate. A gate that
  ignores it keeps every plugin route private, which fails closed.
- Local development of a plugin with secrets needs them in the environment,
  test keys included, or the daemon does not start. That is deliberate: a
  silently missing key would surface only when a customer pays.
- Plugins already published declare neither list and behave as before.
