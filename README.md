# dsh-plugins

[Chinese documentation](README.zh-CN.md)

A small pnpm monorepo for focused DeepSeek Harness plugins that do not need a repository of their own. Each package under `plugins/` is an independently installable DSH bundle or native preset; see its installation instructions.

This README also catalogs klarkxy's public DSH plugins on npm, including packages maintained in other repositories. The browsable version is the [plugin site](https://klarkxy.github.io/dsh-plugins/). When a new plugin is published, add it to `site/catalog.json` and to both READMEs.

## Plugins and presets

| Package | Purpose | npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | Browse official DSH docs and let Creator mode search and read them with native tools. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-pruner`](plugins/dsh-pruner/README.md) | Simplify mode: review and simplify code while preserving existing functionality. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-pruner) |

Install individual plugins from npm:

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

Creator mode uses `dsh_docs_search` and `dsh_docs_fetch` from `dsh-dev-index` to read live [official DSH documentation](https://deepseek-harness.github.io/deepseek-harness/) and verify runtime contracts.

## Plugin site

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) lists every plugin in Chinese and English, with a detail page per plugin: install commands in dependency order, the package README, requirements, and version history. It also publishes `plugins.json` and `llms.txt` for tools and agents.

`site/catalog.json` is the only hand-maintained part: slug, package, category, titles and summaries, README paths, and source repository. Versions, dates, dependencies, READMEs, and icons come from npm and jsDelivr at build time, so a release from another repository appears without a commit here.

```bash
pnpm site:build   # fetch live data and write _site/
pnpm site:test    # offline rendering tests, also part of pnpm check
```

`.github/workflows/pages.yml` builds and deploys `_site/` on every `main` push, after each npm publish run, and once a day. If npm or jsDelivr cannot be reached the build fails and the previous deployment stays online. Pages → Source must be GitHub Actions. Old development-index URLs such as `/areas/*.html` redirect to the official DSH documentation.

## Additional published plugins

Package names link to npm. Follow each plugin's documentation for installation, host compatibility, and configuration.

| Package | Purpose | Documentation |
| --- | --- | --- |
| [`@klarkxy/dsh-ai-services`](https://www.npmjs.com/package/@klarkxy/dsh-ai-services) | Shared model routing, bounded auxiliary calls, and usage receipts. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-ai-services#readme) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | Update session titles from the latest human task while preserving manual names. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-fusion`](https://www.npmjs.com/package/@klarkxy/dsh-fusion) | Persistent Lead and Sidekick collaboration with author-reviewed writing candidates. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-fusion#readme) |
| [`@klarkxy/dsh-memory`](https://www.npmjs.com/package/@klarkxy/dsh-memory) | Scoped vocabulary, preferences, recent activity, and Dream memory consolidation. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-memory#readme) |
| [`@klarkxy/dsh-model-center`](https://www.npmjs.com/package/@klarkxy/dsh-model-center) | Configure model tiers, provider connections, and AI call limits. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-model-center#readme) |
| [`@klarkxy/dsh-mood`](https://www.npmjs.com/package/@klarkxy/dsh-mood) | Clarify ambiguous requests before agent execution. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-mood#readme) |
| [`@klarkxy/dsh-recap`](https://www.npmjs.com/package/@klarkxy/dsh-recap) | Generate session recaps and inject bounded agent checkpoints. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-recap#readme) |
| [`@klarkxy/dsh-self-improvement`](https://www.npmjs.com/package/@klarkxy/dsh-self-improvement) | Learn conditional methods from outcome evidence, with optional skill export. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-self-improvement#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | Manage web search providers and public-page fetching. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | Zhihu search, agent tools, knowledge bases, and usage tracking. | [Docs](https://github.com/klarkxy/dsh-editor/tree/main/packages/dsh-zhihu#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | Discover, review, and install reusable capabilities. | [Docs](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |

## Development

Requires Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm check
```

Each package owns its assets, tests, and release version. Native presets need no runtime plugin or build. The repository root is not itself a DSH bundle.

## Automatic npm releases

Every `plugins/dsh-xxx` package is named `@klarkxy/dsh-xxx` and selects the public npm registry. `.github/workflows/npm-publish.yml` checks packages on every `main` update. It can also be retried manually from Actions; release tags are not required.

After building, CI fingerprints the files selected by `npm pack` and compares them with the published package. Only changed packages or explicitly higher versions are published. Repository docs, the index website and tests excluded from the archive do not cause npm releases. Version fields and CI's own `dshRelease.contentHash` are excluded from the fingerprint to avoid release loops.

First releases keep the source version; an explicitly higher version takes precedence. Changed contents with no version increase get an automatic patch bump, or a prerelease counter bump for prereleases. CI updates `package.json` and any `dsh.plugin.json`, runs checks, publishes and verifies the archive, then commits the version back to `main`. Stable releases use `latest`; prereleases use `next`. Choose minor/major versions explicitly for new features or breaking changes; automatic patching does not replace compatibility judgment.

Publishing runs are serialized. Superseded commits are skipped and version writeback uses a normal fast-forward push, preserving concurrent commits. Bot commits do not recursively trigger workflows. Success requires the registry archive integrity to match the local archive. Retry failures from the latest `main`; unchanged packages already published successfully are skipped.

npm may scan packages before making them available. CI submits all changed packages first, then waits up to 20 minutes and verifies anonymous archive downloads. A timeout fails explicitly; retries recognize already accepted versions.

Use the repository Actions secret `NPM_TOKEN` for first publication. Then configure a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) per package: owner `klarkxy`, repository `dsh-plugins`, workflow `npm-publish.yml`, no environment, and direct publishing allowed. The token can then be removed. Version writeback needs the workflow's `contents: write` permission and branch rules that allow the bot to push to `main`.

## License

[SATA License 2.1](LICENSE)

## Editor public-plugin extraction

Nine portable packages are now maintained under `plugins/`. Package names, runtime code and persisted settings are unchanged. Zhihu, manuscript, proofread and application-private packages remain in Editor. Desktop preinstallation and offline startup are unchanged. See [handoff and validation](docs/editor-plugin-migration.md).
