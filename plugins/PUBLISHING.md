# Publishing public plugins

Each `plugins/` package owns its tests and version. Run the repository's frozen install and `pnpm check` before requesting a release. See the root [automatic release documentation](../README.md#automatic-npm-releases).

For the nine packages extracted from Editor, publication is deliberately held until ownership handoff is complete. Follow [the migration handoff](../docs/editor-plugin-migration.md#publication-handoff-closed-by-default); merging their source does not authorize two repositories to publish the same package.

For a local manual archive use `pnpm --filter <package-name> pack`, which resolves pnpm workspace dependencies. The CI publisher uses `scripts/release-workspace.mjs` to stage the same publishable dependency ranges before fingerprinting and packaging.
