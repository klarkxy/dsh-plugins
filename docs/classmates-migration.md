# Classmates workspace migration

The local `D:\0 code\dsh-teammates` source now lives in `plugins/dsh-classmates`. Its package name remains `@klarkxy/dsh-classmates`, version `0.2.0-alpha.1`. The original directory is kept as a backup; continue plugin development in this workspace.

Source, tests, build and acceptance helpers, locale files, design notes, screenshots, and historical acceptance records are preserved. Dependencies and generated output, the standalone npm lockfile, local profiles, model configuration, recordings, and demo workspaces are not imported. Historical demo scripts still require their original local inputs; they are outside the default test suite. Historical evidence files are unchanged and describe their original environment.

The target remains DSH `0.1.7-rc.2` and Node.js 24. The workspace uses pnpm's shared lockfile. The directly imported Windows ACL helper is now declared explicitly, and Playwright matches the workspace's `1.62.1` override. No plugin runtime behavior or persisted role/session format is changed.

The package remains unpublished, with `UNLICENSED` preserved and `private: true` preventing publication. Release discovery skips private packages; build, typecheck, tests, and pack checks still include them. It is absent from the public site catalog. A first public release requires a license decision and explicit publication authorization; a catalog entry requires an npm `latest` release.

Run from the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-classmates check
pnpm --filter @klarkxy/dsh-classmates pack
pnpm check
```

No installed DSH profile is changed by this migration. Live model/browser acceptance from the old directory remains historical evidence.

## Migration verification (2026-09-27)

- Compared all 103 source, test, helper, documentation, and locale files against the original directory; their contents match.
- Workspace typechecking passed. Classmates passed 81 tests in 11 files. Release checks passed 19 tests, including private-package exclusion. Site tests and Editor build-boundary tests passed.
- All workspace builds and pack dry runs passed. A local Classmates archive was created and inspected for both entrypoints, the bundle patch, locales, and the retained private flag.
- The shared lockfile passed frozen validation. Its new dependency graph includes the existing full DSH development host; three existing DSH peer-context identifiers were recalculated without changing those package versions.
- Full `pnpm check` stops at the unchanged `dsh-safe-auto` tests on Windows (46 failures). Its path policy explicitly limits v0.1 to POSIX filesystems; symlink cases also fail with EPERM here. Remaining package tests were run separately and passed. This migration does not change that policy or claim a green full Windows check.
- No live browser/model acceptance, npm publication, Git commit, or push was performed. The original local directory remains intact.
