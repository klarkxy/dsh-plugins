# Repository Plan: DSH plugin collection

## Architecture

- Keep the repository root private and non-installable; each independently installable bundle lives under `plugins/`.
- Shared libraries (`dsh-plugin-kit`, `dsh-model-route`) are workspace members that other plugins consume; they publish only after passing the same release checks.
- All plugins target the open host compatibility range `>=0.1.7-rc.2`; development pins use exact DSH versions via the root `devDependencies`/`overrides`.
- The plugin site (`site/`) renders a browsable catalog from `site/catalog.json` plus live npm data; only plugins with an npm `latest` tag belong in the catalog.

## Release model

- `scripts/plugin-release-states.json` is the irreversible lifecycle registry: Draft → Testing → Published.
- Normal auto-publish selects Published packages whose content fingerprint changed; Testing packages need explicit first-release selection.
- Holds (`scripts/npm-release-holds.json`) and private packages are excluded from automatic publication but still run through `pnpm check`.
- CI publishes stable versions to `latest` and prereleases to `next`; patch bumps are automatic for unchanged-version content changes.

## Current state (2026-10-14)

- 15 workspace packages; 14 published on npm, all with `latest` tags.
