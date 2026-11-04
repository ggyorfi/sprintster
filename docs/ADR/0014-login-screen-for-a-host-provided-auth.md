# 14. A login screen for auth the host provides

Date: 2026-11-03

## Status

Accepted.

## Context

The Cloudflare Worker gates an app with Basic Auth from two secrets: one user
per app, and the browser's own credentials dialog, which cannot log out and
cannot be styled. Apps now need a few users each, a real login screen and a
logout.

Who the users are, how passwords are stored and how sessions are issued differ
by deployment: one host keeps users in its own service shared by many apps,
another may put an identity provider in front. None of that is the engine's
concern, and the engine should not hold passwords. What only the engine can do
is the screen: the web GUI is its bundle.

## Decision

**The engine draws the login screen; the host checks the credentials.** The
engine never sees a password store, a session or a token.

### Config

The app config gains an optional `auth`:

```json
"auth": { "login": "/_auth/login", "logout": "/_auth/logout", "refresh": "/_auth/refresh" }
```

All three are paths served by the host in front of the daemon, resolved
against the app root as the API is ([ADR 12](./0012-web-gui-mountable-under-any-base-path.md)).
`loadConfig` requires each to start with `/` and rejects one whose first
segment is a daemon route (reserved or an object route), since the daemon
would answer it instead of the host. Without `auth` nothing changes.

`/health` stays outside any gate and reports `auth`, so the GUI learns where
to log in before it can read `/config`.

### The contract with the host

- `POST login` with JSON `{ username, password }`. A 2xx means logged in, with
  whatever the host set (cookies in practice). Anything else is a refusal; the
  screen shows the response's `message`, or a generic one.
- `POST refresh` with no body. A 2xx means the session was renewed.
- `POST logout` with no body. The GUI shows the login screen whatever the
  answer.
- Any API route answering 401 means "not logged in".

Requests carry credentials the way they already do: same origin, so the
browser sends the host's cookies. An API on another origin (`VITE_API_URL`) is
not supported with `auth`.

### The web GUI

- On start it reads `/health`. With `auth` set it renders the app as before;
  the first 401 sends it to the login screen.
- On a 401 it calls `refresh` once and retries the request. Concurrent 401s
  share one refresh call, so a host that makes refresh tokens single use never
  sees the same one twice. If refresh fails, it shows the login screen and,
  after a successful login, reloads the app's state.
- A logout button appears in the app chrome.

The TUI does not change: it is not a browser and authenticates by header if
the host asks for one.

## Consequences

- Hosts own every security decision: hashing, lockout, session length, token
  rotation, CSRF defences on their own routes. The engine's part is small
  enough to review at a glance.
- The Worker's Basic Auth stays for apps that want one shared password; an app
  using `auth` leaves its secrets unset and puts its own gate in front.
- `/health` becomes part of the auth contract and must stay public on every
  host.
- Roles and per-user permissions are not part of this decision. Nothing in the
  GUI hides or disables anything per user.
