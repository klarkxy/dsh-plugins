# Editor public-plugin extraction

## Current maintained scope

The extracted packages still maintained in this repository are:

| Package (`@klarkxy/` scope) | Version at extraction |
| --- | --- |
| dsh-current-title | 0.1.4 |
| dsh-web-search-manager | 0.1.7 |
| dsh-zhihu | 0.1.7 |

The source was `klarkxy/dsh-editor` revision `66d03814ecdac679947e9198c2e9be931462703a`; Zhihu has its own pinned consumer revision in `scripts/editor-plugin-migration.json`. That manifest retains source-file fingerprints for these maintained packages only. The complete original extraction remains in Git history.

Package identities and stored data remain compatible with their extraction contracts. Current feature calls use the native host `llm` service through `@klarkxy/dsh-plugin-kit`; model selection follows each feature's settings and the host/session defaults. The shared kit does not start background inference. The current client settings use the host's plugin configuration slots and injected UI primitives.

Manuscript, proofread and application-private packages remain in Editor. Desktop packaging, preinstallation and offline profile startup remain Editor responsibilities.

## Build and test ownership

Run `pnpm install --frozen-lockfile` and `pnpm check`. Each maintained package owns its tests. Shared source aliases live in `tsconfig.editor-plugins.json` and `vitest.editor-plugins.config.ts`; browser wrapping and node-shim/style-ownership regressions live under `scripts/editor-plugins/`.

`pnpm test:e2e:web-search` exercises the real registration entry through an isolated browser fixture. It does not claim installed Desktop activation or live provider acceptance.

## Publication ownership

The handoff is complete: `scripts/editor-plugin-migration.json` has `holdPublish: false` and lists the three packages above. This repository owns their source and publication. Editor consumes published packages and must not independently publish the same names.

The [release guide](../RELEASING.md) governs current lifecycle, first publication and normal updates. Existing publication history survives maintenance and source retirement. Release plans resolve workspace dependency ranges and verify the exact planned contents before npm submission.

## Historical verification

Extraction CI run [36305516870](https://github.com/klarkxy/dsh-plugins/actions/runs/36305516870) passed the extraction-time frozen installation and full repository checks. Those results apply to that source snapshot; current checks are required for later changes. No historical CI result implies current installed-host, browser, provider or installer acceptance.
