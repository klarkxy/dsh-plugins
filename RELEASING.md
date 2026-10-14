# Plugin lifecycle and releases

[简体中文](RELEASING.zh-CN.md) · [Current registry](README.md#plugin-lifecycle)

`scripts/plugin-release-states.json` records the lifecycle of every `plugins/*` package, including shared libraries and private development packages. It moves forward only: **Draft → Testing → Published**.

| Stage | Meaning | Publication |
| --- | --- | --- |
| `draft` | Under development, before testing | Never publish |
| `testing` | Completing checks and acceptance for its first delivery | No automatic publication; explicitly select its first release |
| `published` | Has npm publication history, including prereleases | Maintain and update normally; never demote |

Bug fixes, README changes, new-feature testing and version updates keep a published package Published. Failed checks block that update only. Holds, freezes, migration ownership and private status are separate from lifecycle. Neither the `latest` nor `next` channel determines the stage.

## Normal maintenance

1. Edit source, configuration, dependencies or packed documentation while retaining `published`.
2. Choose a version according to compatibility, then run relevant tests, builds, archive checks and target-host acceptance where needed. Maintenance requires no manual lifecycle re-promotion or refreshed acceptance fingerprint.
3. The publisher compares current archive contents with npm, runs `pnpm check`, revalidates the saved plan, publishes, and verifies anonymous archive downloads. Failure never lowers the stage. Edits to `README*.md`, `ACCEPTANCE.md`, `NOTICE.md`, `CHANGELOG*.md` and `docs/` are still packed but do not force a new version; npm documentation refreshes with the next code release. Version, dependency and code changes publish as usual.

Existing release holds still require their stated conditions to be resolved. Use `scripts/npm-release-holds.json` to pause an update when needed. Private packages never publish. Obsolete source can be removed. Set `retired: true` on its existing registry entry, retaining only its lifecycle and publication history; it no longer participates in builds, active tables or releases.

## First publication

Register a new package as `draft`, advance it manually to `testing` when testable, and sync documentation. Before its first release, inspect the final archive, license, dependencies, entrypoints, relevant tests and target-host user scenarios. Reports may remain in the repository, but three permanent mandatory evidence fields are not required.

After explicit authorization, manually run **Publish npm plugins** in Actions and enter full package names, separated by spaces, in `first_release`. A local plan can also be prepared:

```sh
pnpm build
node scripts/publish-npm.mjs plan --first-release @klarkxy/dsh-example
pnpm check
# Run only after explicit npm publication authorization:
node scripts/publish-npm.mjs publish
```

- Ordinary pushes and plans without first-release selection update only Published public packages.
- Draft, private, held and migration-frozen packages cannot bypass their restrictions.
- New public dependencies in Testing must be explicitly selected together or published first. Selection never expands silently.
- Passing checks or preparing a plan does not change lifecycle. Only a successful anonymous npm archive download with matching integrity records Published, its historical `publication` proof, and updated root README tables.
- npm acceptance while scanning, network errors and mismatched archives are not recorded as verification success.

Each verified result is saved immediately in `.artifacts/npm-release/verified-publications.json`. Later submission or verification failures preserve earlier successes; CI always uploads the plan, archives and verified records. Source writeback may not have happened after failure. Retry from the latest `main` with the same `first_release` selection: an identical accepted version is not resubmitted, and re-verification restores the lifecycle writeback. A partially successful batch must not be treated as entirely unpublished.

## Lifecycle validation

```sh
pnpm release:status     # Lifecycle, private status and blockers
pnpm release:docs       # Sync both root README tables
pnpm release:check      # Lifecycle, documentation and publisher regressions
pnpm release:fingerprint @klarkxy/dsh-example  # Diagnostic contents; no stage mutation
```

The registry uses `schemaVersion: 2`. A Published entry retains one immutable npm version, publication time and archive integrity in `publication`. This proves historical publication, not acceptance of the current source. Normal updates do not rewrite it. Legacy schema 1 described reversible source readiness and is accepted only as a one-time migration baseline.

Local checks compare the working tree with `HEAD`. Publishing CI sets `RELEASE_STATE_BASE` to the pre-push commit, covering the whole push; manual retries use `HEAD^`. Backwards stages, deleting historical entries (retain `retired: true` when removing source), skipping Testing and rewriting publication history fail. A missing historical registry is initialization; Git baseline errors are not swallowed.

On 2026-10-13, public npm history restored 12 published packages; `dsh-chatgpt`, `dsh-grok-build`, `dsh-minimax-code` and `dsh-unrestricted` were then first-published the same day. All 14 non-retired workspace packages are now Published. Historical acceptance reports are retained; `acceptedContentHash` is no longer a lifecycle gate.

## Per-plan content and dependencies

Plans automatically capture `sourceHashes` for packages and their local dependency closure. Preflight recomputes them and rejects stale source, dependency or archive contents. Version fields, CI-owned metadata and normal workspace version substitution do not masquerade as source changes; archive checks still include resolved dependency versions. Legacy plans must be regenerated.

All local dependency fields participate. Public dependencies must be Published or explicitly selected for first publication. Private Testing development dependencies may be built, checked and bundled with their consumer; Draft dependencies still block. Private runtime, optional and peer dependencies cannot remain in a public package. A held dependency supplying an npm version must already have that exact version available; bundled source still receives the current plan's content check.

Fixing release tooling, preparing plans and registering history do not authorize commits, pushes, npm publication or deployment.
