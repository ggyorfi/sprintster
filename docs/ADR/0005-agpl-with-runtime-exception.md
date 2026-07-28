# 5. AGPL-3.0 with a runtime and output exception

Date: 2026-07-18

Reconstructed after the fact. The decision is embodied in `318b97c`, the second
commit in the repository.

## Status

Accepted

## Context

We want improvements to the engine to come back to the project, including from
people who run it as a network service rather than distributing it. Plain AGPL
achieves that, but it would also reach the applications built on top of the
engine, and nobody would build one on those terms.

## Decision

The project is licensed `AGPL-3.0-only WITH LicenseRef-sprintster-runtime-exception`
(`LICENSE`, `LICENSE-EXCEPTION`).

The engine is copyleft. Applications built with it, their configs, and the
artifacts it generates are not.

## Consequences

- Changes to the engine must be shared, including when it is only ever reached
  over a network, which is the case AGPL exists for.
- App authors can keep their own work private, which is the condition for anyone
  adopting this at all.
- The exception is a custom `LicenseRef`, so tooling that only recognises
  standard SPDX identifiers may flag or misreport it.
- No source file carries an SPDX header today. Adding them piecemeal is worse
  than not having them, so we either adopt them everywhere at once or not at
  all.
