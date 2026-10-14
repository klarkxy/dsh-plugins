# Publishing public plugins

Each `plugins/` package owns its tests and version. Before requesting a release, run the repository's frozen install and `pnpm check`, and follow the [release guide](../RELEASING.md).

`scripts/npm-release-holds.json` holds candidates pending acceptance. Both planning and publication enforce it, including previously saved plans. Remove a hold only after checking final package contents, relevant tests and behavior in the target DSH host, including bundled workspace dependencies. The older Editor handoff gate is separately recorded in `scripts/editor-plugin-migration.json`; it now lists only packages still maintained here. Merging source never authorized two repositories to publish the same package.

For a local manual archive, use `pnpm --filter <package-name> pack`, which resolves pnpm workspace dependencies. The CI publisher uses `scripts/release-workspace.mjs` to stage the same publishable dependency ranges before fingerprinting and packaging.

A held package can supply a workspace dependency version to another plugin only when that exact version already exists on npm. It stays excluded from version updates and publication, and an unpublished held dependency blocks the release plan. As of 2026-10-14 the hold list is empty.

Development packages may use `private: true`. They remain workspace members and run through `pnpm check`, but release discovery excludes them. Public packages require public npm access and registry in `publishConfig`.

Stable versions publish to `latest`. All published packages currently appear on `latest`. Only DSH bundles with an npm `latest` tag belong in the site catalog; shared libraries (Plugin Kit, Model Route) were added on 2026-10-14 so their install order and README pages resolve. Session Manager's advanced thread actions require the separately delivered host patch in `host-patches/thread-management/`.
