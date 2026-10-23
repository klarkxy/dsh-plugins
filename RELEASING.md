# Plugin lifecycle and releases

[简体中文](RELEASING.zh-CN.md) · [Current registry](README.md#plugin-lifecycle)

`scripts/plugin-release-states.json` records the lifecycle of every `plugins/*` package, including shared libraries and private development packages. It moves forward only: **Draft → Testing → Published**.

| Stage | Meaning | Publication |
| --- | --- | --- |
| `draft` | Under development, before testing | Never publish |
| `testing` | Completing checks and acceptance for its first delivery | No automatic publication; explicitly select its first release |
| `published` | Has npm publication history, including prereleases | Maintain and update normally; never demote |

Fixes, README changes, new-feature testing and version updates keep a published package Published; failed checks block only that update. Holds, freezes, migration ownership and private status are managed separately; the `latest` / `next` channels do not determine the stage.

## Normal maintenance

1. Edit source, configuration, dependencies or packed documentation while retaining `published`.
2. Choose a version by compatibility, then run relevant tests, builds, archive checks and target-host acceptance where needed; maintenance needs no manual lifecycle re-promotion or refreshed acceptance fingerprint.
3. The publisher compares current archive contents with npm, runs `pnpm check`, revalidates the saved plan, publishes and verifies archive downloads; failure never lowers the stage. Edits to `README*.md`, `ACCEPTANCE.md`, `NOTICE.md`, `CHANGELOG*.md` and `docs/` are still packed but do not force a new version; npm documentation refreshes with the next code release. Version, dependency and code changes publish as usual.

Existing release holds must be resolved for their stated reasons (`scripts/npm-release-holds.json`). Private packages never publish. Obsolete source can be removed: set `retired: true` on its registry entry, retaining its lifecycle and publication history; it no longer participates in builds, active tables or releases.

## First publication

Register a new package as `draft`, advance it manually to `testing` when testable, and sync documentation. Before its first release, inspect the final archive, license, dependencies, entrypoints, relevant tests and target-host user scenarios; these checks belong to that delivery, and no permanent acceptance report is kept in the repository.

After explicit authorization, manually run **Publish npm plugins** in Actions and enter full package names, separated by spaces, in `first_release`. A local plan can also be prepared:

```sh
pnpm build
node scripts/publish-npm.mjs plan --first-release @klarkxy/dsh-example
pnpm check
# Run only after explicit npm publication authorization:
node scripts/publish-npm.mjs publish
```

- Ordinary pushes and plans without first-release selection update only Published public packages.
- Draft, private, held and migration-frozen packages cannot bypass their restrictions through first release.
- New public dependencies in Testing must be explicitly selected together or published first; selection never expands silently.
- Passing checks or preparing a plan does not change lifecycle. Only an anonymous npm archive download with matching integrity records `published`, its historical `publication` proof, and updates the root README tables. Still-scanning, network errors and mismatched archives are not verification success.

Each verified result is saved immediately in `.artifacts/npm-release/verified-publications.json`; later submission or verification failures preserve earlier successes, and CI always uploads the plan, archives and verified records. Source writeback may not have happened after failure: retry from the latest `main` with the same `first_release` selection — an identical accepted version is not resubmitted, and re-verification restores the lifecycle writeback. A partially successful batch must not be treated as entirely unpublished.

## Lifecycle validation

```sh
pnpm release:status     # Lifecycle, private status and blockers
pnpm release:docs       # Sync both root README tables
pnpm release:check      # Lifecycle, documentation and publisher regressions
pnpm release:fingerprint @klarkxy/dsh-example  # Diagnostic contents; no stage mutation
```

The registry uses `schemaVersion: 2`: a Published entry's `publication` retains one existing npm version, publication time and archive integrity — immutable historical proof, not acceptance of the current source; normal updates do not rewrite it. Legacy schema 1 described reversible source readiness and is accepted only as a one-time migration baseline.

Local checks compare the working tree with `HEAD`; publishing CI sets `RELEASE_STATE_BASE` to the pre-push commit, and manual retries use `HEAD^`. Backwards stages, deleting historical entries (retain `retired: true` when removing source), skipping Testing and rewriting publication history fail. A missing historical registry is initialization; Git baseline errors are not swallowed as one. For current lifecycle state, run `pnpm release:status`.

## Per-plan content and dependencies

Plans automatically capture `sourceHashes` for packages and their local dependency closure, recompute them before publishing, and reject stale source, dependency or archive contents; version fields, CI-owned metadata and normal workspace version substitution do not masquerade as source changes, while archive checks still include resolved dependency versions. Legacy plans must be regenerated.

All local dependency fields participate: public dependencies must be Published or explicitly selected for first publication in the same batch; private Testing development dependencies may be built, checked and bundled with their consumer, while Draft dependencies still block; a public package cannot keep private runtime, optional or peer dependencies. A held dependency supplying an npm version must already have that exact version available; its bundled source still receives the current plan's content check.

Fixing release tooling, preparing plans and registering history do not authorize commits, pushes, npm publication or deployment.
