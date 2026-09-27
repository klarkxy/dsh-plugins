# Acceptance record

Date: 2026-09-27. Status: implementation/source preview; native end-to-end acceptance is pending.

## Executed in this development environment

Node.js 22.16.0, Linux, isolated temporary directories.

- `npm test`: 84 passed, 0 failed, 0 skipped. Pure-core cases cover strict JSON/J/Z parsing, Unicode and size limits, default inclusion and exclusions, preserved order, two-stage imports, native revision fences, one-use plans, partial failure reporting, connection-target guarding, schema secrets including intersections and new dictionary entries, interruption and final-order verification.
- Adapter contract fixtures exercise the actual `official.mjs` and `index.mjs` implementations against a synthetic Context with the inspected upstream signatures. They verify redacted native reads, page-independent scope, package/row ownership, malformed policy handling, native install/mutate/cancel arguments, sanitized results and explicit confirmation. They do not load a real DSH host.
- A VM client-registration test executes `client.js` with a synthetic module loader and React facade. It verifies the official manager page and contextual share action registrations. This is not a browser visual or interaction test.
- `npm run build`: JavaScript syntax checks of all six executable source files.
- Distribution contents checked with `npm pack --dry-run` and a real local `npm pack`; tests and development files are not shipped. The packed core can be imported and its codec round-tripped without third-party dependencies.

The alpha.2 scope revision adds ten tests: custom-only storage is not read, plugin-list sharing still works, unsupported imported settings block before writes, stale selections fail, author policy cannot widen native access, inactive/mismatched entries are excluded, browser page metadata is rejected, native defaults remain shareable, and the client does not enumerate configuration slots. Existing presentation tests now verify native support regardless of page slots or `autoGenerate`.

No real `~/.dsh`, model provider, credential store or network installation was touched.

## Not established by those tests

The local shell cannot resolve GitHub and pnpm is not installed; dependency installation and the root monorepo checks were not run locally. No claim is made that a particular released DSH npm/desktop build has passed the whole workflow. The root monorepo `pnpm check`, genuine HTTP authentication, HMR/plugin lifecycle behavior, cross-editor races and a real browser remain to be checked in a configured runtime/CI environment.

Before a stable release, use a fresh throwaway DSH Home and a non-production profile to install the actual tarball, verify Plugins-page mounting, export/import a real npm bundle in both modes, inspect bundle order, confirm secrets remain local, exercise post-install configuration preview and native restart/failure cases, and test browser reload/cancellation. Repeat on supported hosts. Do not claim a green unit-test run covers these steps.

The package remains a prerelease; it is not added to the site's npm-backed catalog until a published `latest` version exists. This change does not remove the source repository's v1 runtime, delete user blueprints, merge a PR or publish to npm.
