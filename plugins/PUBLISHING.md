# Publishing public plugins

Each `plugins/` package owns its tests and version. Before requesting a release, run the repository's frozen install and `pnpm check`, and follow the root [automatic release documentation](../README.md#automatic-npm-releases).

The packages extracted from Editor are no longer held: `scripts/editor-plugin-migration.json` carries `holdPublish: false` and lists the eight packages that still live here, after `dsh-ai-services` and `dsh-model-center` were removed. The handoff decision and its original conditions are recorded in [the migration handoff](../docs/editor-plugin-migration.md#publication-handoff-closed-by-default). Merging their source never authorized two repositories to publish the same package.

For a local manual archive, use `pnpm --filter <package-name> pack`, which resolves pnpm workspace dependencies. The CI publisher uses `scripts/release-workspace.mjs` to stage the same publishable dependency ranges before fingerprinting and packaging.

A held package can supply a workspace dependency version to another plugin only when that exact version already exists on npm. It stays excluded from version updates and publication, and an unpublished held dependency blocks the release plan.

Unpublished development packages may use `private: true`. They remain workspace members and run through `pnpm check`, but release discovery excludes them. Classmates keeps its local alpha version and `UNLICENSED` status; choosing a public license and enabling its first release are separate decisions. Add it to the site only once npm has a `latest` release.
