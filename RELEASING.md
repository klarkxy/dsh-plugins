# Plugin lifecycle and releases

[简体中文](RELEASING.zh-CN.md) · [Current registry](README.md#plugin-lifecycle)

`scripts/plugin-release-states.json` records the lifecycle of every `plugins/*` package, including shared libraries and private development packages. It moves forward in one direction: **Draft → Testing → Published**.

| Stage | Meaning | Publication |
| --- | --- | --- |
| `draft` | Under development, before testing | Local development only |
| `testing` | Completing checks and acceptance for its first delivery | Published only when explicitly selected for first release |
| `published` | Has npm publication history, including prereleases | Maintained and updated through the standard release flow |

Fixes, README changes, new-feature testing, and version updates keep a published package in `published`; failed checks stop only that update. Holds, freezes, migration ownership, and private status are managed separately, independent of the `latest` and `next` channels.

## Normal maintenance

1. Edit source, configuration, dependencies, or packed documentation while keeping `published`.
2. Choose a version by compatibility, then run the relevant tests, builds, archive checks, and target-host acceptance checks.
3. The publisher compares current archive contents with npm, runs `pnpm check`, revalidates the saved plan, publishes, and verifies archive downloads; a failed run leaves the lifecycle stage unchanged. Edits to `README*.md`, `ACCEPTANCE.md`, `NOTICE.md`, `CHANGELOG*.md`, and `docs/` are packed into the archive and ship with the next code release. Version, dependency, and code changes publish as usual.

Release holds are cleared once their stated conditions in `scripts/npm-release-holds.json` are resolved. Private packages stay local. To retire obsolete source, set `retired: true` on its registry entry: this keeps its lifecycle and publication history while excluding it from builds, active tables, and releases.

## First publication

Register a new package as `draft`, advance it manually to `testing` when ready for testing, and sync documentation. Before its first release, inspect the final archive, license, dependencies, entrypoints, relevant tests, and target-host user scenarios as part of that delivery.

After explicit authorization, manually run **Publish npm plugins** in Actions and enter full package names, separated by spaces, in `first_release`. You can also prepare a local plan:

```sh
pnpm build
node scripts/publish-npm.mjs plan --first-release @klarkxy/dsh-example
pnpm check
# Run only after explicit npm publication authorization:
node scripts/publish-npm.mjs publish
```

- Ordinary pushes and plans without first-release selection update only `published` public packages.
- Draft, private, held, and migration-frozen packages remain excluded even when listed in `first_release`.
- New public dependencies in `testing` must be listed together in `first_release` or published beforehand.
- Lifecycle promotion to `published` happens once the npm archive downloads anonymously with matching integrity; this also records the historical `publication` proof and updates the root README tables.

Each verified result is saved immediately in `.artifacts/npm-release/verified-publications.json`; if a later package fails, earlier verified packages stay recorded and CI uploads the plan, archives, and verified records. To finish a partial run, retry from the latest `main` with the same `first_release` selection: already accepted versions with matching integrity are reused, and re-verification completes the lifecycle writeback.

## Lifecycle validation

```sh
pnpm release:status     # Lifecycle, private status and blockers
pnpm release:docs       # Sync both root README tables
pnpm release:check      # Lifecycle, documentation and publisher regressions
pnpm release:fingerprint @klarkxy/dsh-example  # Diagnostic contents; read-only
```

The registry uses `schemaVersion: 2`: a `published` entry's `publication` retains one existing npm version, publication time, and archive integrity as immutable historical proof. Legacy schema 1 serves only as a one-time migration baseline.

Local checks compare the working tree with `HEAD`; publishing CI sets `RELEASE_STATE_BASE` to the pre-push commit, and manual retries use `HEAD^`. Validation requires forward stage progression through `testing`, retention of all historical entries (use `retired: true` when removing source), and preservation of `publication` records. A missing historical registry initializes a new baseline, while Git read errors fail fast. Run `pnpm release:status` to inspect current lifecycle state.

## Per-plan content and dependencies

Plans capture `sourceHashes` for packages and their local dependency closure, recompute them before publishing, and require current source, dependencies, and archive contents to match the plan. Version fields, CI-owned metadata, and workspace version substitution are normalized during source hashing, while archive checks still verify resolved dependency versions.

All local dependency fields participate in the closure check: public dependencies must be `published` or explicitly selected in `first_release` in the same batch; private `testing` development dependencies may be built, checked, and bundled with their consumer; public packages may depend only on public runtime, optional, and peer packages. A held dependency supplying an npm version must already have that exact version published, and its bundled source is checked against the current plan.

Commits, pushes, npm publication, and site deployment require explicit user authorization.
