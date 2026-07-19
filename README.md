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
