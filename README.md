# sprintster

Config-driven, event-sourced application engine: declare objects, lists, and
forms as data; a generic runtime drives the read/write path and TUI/web
frontends.

## Quick start

```
npm create sprintster my-app
cd my-app
s8r dev
```

## Documentation

Full docs live in [`docs/`](docs/README.md):

- [Getting started](docs/getting-started.md): scaffold and run a project.
- [Configuration](docs/configuration.md): the config file, environments,
  backends, and blob storage.
- [Objects and properties](docs/objects-and-properties.md): objects, lifecycle,
  property types, validation.
- [Views and lists](docs/views-and-lists.md): forms and list screens.
- [CLI (`s8r`)](docs/cli.md): the commands that run your app.

The docs describe what exists today. [Roadmap](ROADMAP.md) covers what we have
decided to build next, and why, and [`docs/ADR/`](docs/ADR/) records the
decisions the architecture rests on.

## Working on sprintster itself

```
pnpm install
pnpm build      # required before the first pnpm test
pnpm test
```

Packages import each other through their published entry points, which resolve
to `dist/`. That directory is not committed, so a fresh clone has to build once
before the test suites can resolve `@sprintster/engine`. Rebuild whenever you
change something another package imports, or its tests will run against the last
build. (The `s8r dev` path does not need this: it resolves workspace imports
straight to TypeScript source.)

## License

sprintster is licensed under **AGPL-3.0-only WITH a runtime and output
exception**.

- The **engine** is copyleft (AGPLv3): if you modify the engine's own source
  and distribute it, or offer a modified engine over a network (including a
  hosted build/deploy service), you must release those modifications.
- The **applications you build** with it, and the **artifacts it generates**
  (installers, executables, deployments) including the embedded runtime, are
  yours to license however you like. See [`LICENSE-EXCEPTION`](LICENSE-EXCEPTION).

Full texts: [`LICENSE`](LICENSE) (AGPLv3) and
[`LICENSE-EXCEPTION`](LICENSE-EXCEPTION).

Source files carry the SPDX identifier:

```
SPDX-License-Identifier: AGPL-3.0-only WITH LicenseRef-sprintster-runtime-exception
```
