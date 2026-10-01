# dsh-plugins

[简体中文](README.zh-CN.md) / English

A small pnpm monorepo for focused DeepSeek Harness plugins that do not need a repository of their own. Each package under `plugins/` is a DSH bundle or native preset that installs, tests, and releases on its own.

This README also catalogs klarkxy's public DSH plugins on npm, including packages maintained in other repositories. The browsable version is the [plugin site](https://klarkxy.github.io/dsh-plugins/). When a new plugin is published, add it to `site/catalog.json` and to both READMEs.

## Published plugins

Package names link to npm for plugins maintained in other repositories and to the package README for the two published from here; the last column points at the other one. Follow each plugin's documentation for installation, host compatibility, and configuration.

| Package | Purpose | Docs / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: read official DSH docs in the Plugins page; Creator mode searches docs and checks plugin npm metadata with native tools. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-pruner`](plugins/dsh-pruner/README.md) | Code Prune: review and simplify code while keeping existing behavior, cutting redundancy and needless abstraction. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-pruner) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | Auto Title: session titles follow the latest task; manual names stay put. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-fusion`](https://www.npmjs.com/package/@klarkxy/dsh-fusion) | Sidekick: persistent Lead–Sidekick collaboration with author-reviewed results. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-fusion#readme) |
| [`@klarkxy/dsh-memory`](https://www.npmjs.com/package/@klarkxy/dsh-memory) | Long-term Memory: scoped vocabulary, preferences, recent activity, and Dream consolidation. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-memory#readme) |
| [`@klarkxy/dsh-mood`](https://www.npmjs.com/package/@klarkxy/dsh-mood) | Mood: record, read and update the current task requirements with the current Agent. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood#readme) |
| [`@klarkxy/dsh-recap`](https://www.npmjs.com/package/@klarkxy/dsh-recap) | Session Recap: background recaps and bounded agent checkpoints. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap#readme) |
| [`@klarkxy/dsh-self-improvement`](https://www.npmjs.com/package/@klarkxy/dsh-self-improvement) | Experience Learning: learn conditional methods from outcome evidence, with optional skill export. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-self-improvement#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | Web Search: manage web search providers and public-page fetching from one settings page. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | Zhihu: Zhihu search, agent tools, knowledge bases, and usage tracking. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`@klarkxy/dsh-git-commit`](https://www.npmjs.com/package/@klarkxy/dsh-git-commit) | Git Commit: commit workspace changes from the conversation header, with model-planned commit groups. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-git-commit#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | Discover, review, and install reusable capabilities. | [Docs](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |

## Unpublished development packages

| Package | Purpose | Status |
| --- | --- | --- |
| [`@klarkxy/dsh-classmates`](plugins/dsh-classmates/README.md) | Teammate Roles: reusable teammate roles and native Team UI enhancements. | Local alpha; excluded from automatic npm publication and the plugin site. |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: budgeted preflight plus one-shot approval escalation. | npm release candidate; the plugin site catalog lists stable releases only. |
| [`@klarkxy/dsh-blueprint`](plugins/dsh-blueprint/README.md) | Blueprint: share a plugin set as an exact-version blueprint code. | npm preview release; the plugin site catalog lists stable releases only. |

Migrated from the local `dsh-teammates` directory. See the [migration record](docs/classmates-migration.md).

## Install

Published plugins install with the DSH plugin manager, which pulls the package from the npm registry:

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

Replace `web` with your profile name, and restart the profile after installing. Each plugin's page on the [plugin site](https://klarkxy.github.io/dsh-plugins/) lists its own install commands in dependency order.

Creator mode uses `dsh_docs_search`/`dsh_docs_fetch` from `dsh-dev-index` to read live [official DSH documentation](https://deepseek-harness.github.io/deepseek-harness/) and verify runtime contracts, and `dsh_plugins_search`/`dsh_plugins_fetch` to check plugin npm metadata before installing anything.

## Plugin site

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) lists every plugin in Chinese and English. Each plugin gets a detail page with install commands in dependency order, the package README, requirements, and version history; the site also publishes `plugins.json` and `llms.txt` for tools and agents.

`site/catalog.json` is the only hand-maintained data: slug, package, category, titles and summaries, README paths, and source repository. Versions, dates, dependencies, READMEs, and icons come from the npm registry and integrity-checked npm package archives at build time, so a release from another repository shows up without a commit here.

```bash
pnpm site:build   # fetch live data and write _site/
pnpm site:test    # offline rendering tests, also part of pnpm check
```

`.github/workflows/pages.yml` builds and deploys `_site/` on every `main` push, after each npm publish run, and once a day. When npm cannot be reached or a package archive fails verification the build fails and the previous deployment stays online. Pages → Source must be GitHub Actions, and old development-index URLs such as `/areas/*.html` redirect to the official DSH documentation.

## Development

Requires Node.js 24 or newer and pnpm 10.

```bash
pnpm install
pnpm check
```

Each package owns its assets, tests, and release version. Native presets need no runtime plugin or build. The repository root is not a DSH bundle.

## Automatic npm releases

Every `plugins/dsh-xxx` package is named `@klarkxy/dsh-xxx`, and public packages select the public npm registry. Private development packages (`private: true`) join checks but stay out of automatic releases. `.github/workflows/npm-publish.yml` checks the packages on every `main` update and can be retried manually from Actions; release tags are not required.

After building, CI fingerprints the files selected by `npm pack` and compares them with the published package, so only changed packages or explicitly higher versions are published. Repository docs, the index website, and tests excluded from the archive never cause an npm release; version fields and CI's own `dshRelease.contentHash` stay out of the fingerprint to avoid release loops.

First releases keep the source version, and an explicitly higher version takes precedence. Changed contents without a version increase get an automatic patch bump, or a prerelease counter bump for prereleases. CI updates `package.json` and any `dsh.plugin.json`, runs checks, publishes and verifies the archive, then commits the version back to `main`; stable releases use `latest` and prereleases use `next`. Choose minor/major versions explicitly for new features or breaking changes — automatic patching does not replace compatibility judgment.

Publishing runs are serialized: superseded commits are skipped, and version writeback uses a normal fast-forward push that preserves concurrent commits. Bot commits do not recursively trigger workflows, and a release counts as successful only when the registry archive integrity matches the local archive. Retry a failure from the latest `main`; unchanged packages already published successfully are skipped.

npm may scan packages before making them available, so CI submits every changed package first, then waits up to 20 minutes and verifies anonymous archive downloads. A timeout fails explicitly, and retries recognize versions npm has already accepted.

Use the repository Actions secret `NPM_TOKEN` for first publication. Then configure a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) per package: owner `klarkxy`, repository `dsh-plugins`, workflow `npm-publish.yml`, no environment, and direct publishing allowed. The token can then be removed. Version writeback needs the workflow's `contents: write` permission and branch rules that allow the bot to push to `main`.

## License

[SATA License 2.1](LICENSE)

## Editor public-plugin extraction

Portable packages extracted from Editor are now maintained under `plugins/`, keeping their package names, tool behavior, and persisted settings; Zhihu swaps its private UI dependency for a package-local structural control adapter. Manuscript, proofread, and application-private packages remain in Editor, and desktop preinstallation and offline startup are unchanged. Details, including the handoff and validation record, are in [the migration document](docs/editor-plugin-migration.md).
