# Editor public-plugin extraction

## Scope and source

Nine public packages move from `klarkxy/dsh-editor` revision `66d03814ecdac679947e9198c2e9be931462703a` into this repository:

| Package (`@klarkxy/` scope) | Existing version |
| --- | --- |
| dsh-ai-services | 0.1.3 |
| dsh-current-title | 0.1.4 |
| dsh-mood | 0.1.4 |
| dsh-recap | 0.1.4 |
| dsh-memory | 0.1.4 |
| dsh-self-improvement | 0.1.4 |
| dsh-model-center | 0.1.3 |
| dsh-fusion | 0.1.0 |
| dsh-web-search-manager | 0.1.7 |

Package names, public exports, plugin IDs, runtime implementation, default toggles, storage-domain names and data formats are preserved. The extraction changes build/test paths and publishing ownership, not plugin behavior. `scripts/editor-plugin-migration.json` records the source revision and SHA-256 of every original package file; it is provenance, not a claim that future revisions remain byte-identical. Git history remains accessible in the original repository.

Zhihu stays in Editor because its build still depends on Editor seats. Manuscript, proofread and all Editor-specific packages also stay there. Desktop packaging and offline profile deployment remain Editor responsibilities. Making the writing environment reproducible through a blueprint remains a future direction; this migration does not redesign blueprints or add startup network installation.

## Build and test ownership

Run `pnpm install --frozen-lockfile` and `pnpm check`. The imported packages retain their own tests, with a dedicated `tsconfig.editor-plugins.json` and `vitest.editor-plugins.config.ts` for shared source aliases. Browser wrapping and its node-shim/style-ownership regressions live under `scripts/editor-plugins/`. Public Fusion Node suites move with Fusion. Editor keeps its host integration tests against published exports.

The optional search-settings browser suite is `pnpm test:e2e:web-search`; install the matching Playwright browser before running it. It was moved, not claimed to have been executed during extraction.

## Publication handoff: closed by default

The nine packages are held by `holdPublish: true` in the migration manifest. Both release planning and publishing exclude them. Existing unrelated packages remain eligible. No npm release is needed for Editor to consume the already-published exact versions.

Merge this source-import PR first, then the Editor consumer/removal PR. Before a separate change removes the hold:

1. Confirm Editor no longer discovers or publishes these packages and no old publishing job remains active.
2. Update each package's npm Trusted Publisher to this repository and workflow, preserving package ownership and names. Do not copy credentials into Git.
3. Validate the packed artifacts and compatibility, then explicitly release from this repository.

The publisher now stages the npm-selected files, resolves supported `workspace:*`, `workspace:^` and `workspace:~` dependencies using current workspace versions, computes fingerprints from that staged content, and publishes the same archive. Dependency-first release planning propagates changed shared-library versions to dependants. Unsupported ranges, cycles, missing targets and stale plans containing held packages fail explicitly. Lifecycle scripts are not run by packing. The source manifests retain workspace references for local development.

## Verification record

Extraction CI run [36305516870](https://github.com/klarkxy/dsh-plugins/actions/runs/36305516870) generated the lockfile, committed the extraction, verified a frozen install and passed the full `pnpm check` on Linux, Node 24.21.0 and pnpm 10.29.2. This includes original package tests, typechecks, builds, npm pack checks, existing site/release tests and six added release-workspace tests. Two of those tests inspect actual npm archives without publishing.

Later PR checks are authoritative for later commits. No claim is made here of real DSH/Electron end-to-end, Windows/macOS installer, or browser visual acceptance. No installed user Home, credentials or application data were touched.
