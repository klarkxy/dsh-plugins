# Publishing public plugins

Each `plugins/` package owns its tests and version. Run the repository's frozen install and `pnpm check` before requesting a release. See the root [automatic release documentation](../README.md#automatic-npm-releases).

For the nine packages extracted from Editor, publication is deliberately held until ownership handoff is complete. Follow [the migration handoff](../docs/editor-plugin-migration.md#publication-handoff-closed-by-default); merging their source does not authorize two repositories to publish the same package.

For a local manual archive use `pnpm --filter <package-name> pack`, which resolves pnpm workspace dependencies. The CI publisher uses `scripts/release-workspace.mjs` to stage the same publishable dependency ranges before fingerprinting and packaging.

A held package can supply a workspace dependency version to another plugin only when that exact version already exists on npm. It stays excluded from version updates and publication; an unpublished held dependency blocks the release plan.

Unpublished development packages may use `private: true`. They remain workspace members and run through `pnpm check`, but release discovery excludes them. Classmates retains its local alpha version and `UNLICENSED` status; choosing a public license and enabling its first release are separate decisions. Add it to the site only once npm has a `latest` release.
