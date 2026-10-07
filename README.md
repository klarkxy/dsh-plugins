# dsh-plugins

[简体中文](README.zh-CN.md) / English

A small pnpm monorepo for focused DeepSeek Harness plugins and shared libraries that do not need a repository of their own. Each package under `plugins/` tests and releases on its own; bundles and native presets install through DSH.

This README also catalogs klarkxy's public DSH plugins on npm, including packages maintained in other repositories. The browsable version is the [plugin site](https://klarkxy.github.io/dsh-plugins/). List preview releases in both READMEs; add a DSH plugin to `site/catalog.json` once npm has its `latest` release.

## Published plugins

Package names link to npm or the package README; the last column provides the other entry point. Follow each plugin's documentation for installation, host compatibility, and configuration. Retired packages remain on npm for historical use.

| Package | Purpose | Docs / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: read official DSH docs in the Plugins page; Creator mode searches docs and checks plugin npm metadata with native tools. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-pruner`](https://www.npmjs.com/package/@klarkxy/dsh-pruner) | Retired locally; historical npm releases remain available. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-pruner) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | Auto Title: session titles follow the latest task; manual names stay put. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-fusion`](https://www.npmjs.com/package/@klarkxy/dsh-fusion) | Retired locally; retained for historical records. Use Classmates roles with native delegation for new work. | [Migration](plugins/dsh-classmates/docs/fusion-migration.md) |
| [`@klarkxy/dsh-mood`](https://www.npmjs.com/package/@klarkxy/dsh-mood) | Retired locally; historical npm releases remain available. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/078b69632ddf054a404fcb81c2543dc8887e2acc/plugins/dsh-mood#readme) |
| [`@klarkxy/dsh-recap`](https://www.npmjs.com/package/@klarkxy/dsh-recap) | Retired locally; historical npm releases remain available. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/078b69632ddf054a404fcb81c2543dc8887e2acc/plugins/dsh-recap#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | Web Search: manage web search providers and public-page fetching from one settings page. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | Zhihu: Zhihu search, agent tools, knowledge bases, and usage tracking. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`@klarkxy/dsh-git-commit`](https://www.npmjs.com/package/@klarkxy/dsh-git-commit) | Git Commit: commit workspace changes from the conversation header, with model-planned commit groups. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-git-commit#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | Discover, review, and install reusable capabilities. | [Docs](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |

## Preview packages (`next`)

| Package | Purpose | Status |
| --- | --- | --- |
| [`@klarkxy/dsh-classmates`](plugins/dsh-classmates/README.md) | Teammate Roles: reusable roles and model profiles for native delegation. | Release candidate on `next`; excluded from the stable plugin catalog. |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: an independent reviewer vets each sandbox escalation; only a pass auto-approves. | npm release candidate; the plugin site catalog lists stable releases only. |
| [`@klarkxy/dsh-blueprint`](plugins/dsh-blueprint/README.md) | Blueprint: share a plugin set as an exact-version blueprint code. | npm preview release; the plugin site catalog lists stable releases only. |
| [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | Font: customize the interface font, code font, and conversation font size of the Web GUI. | Release candidate on `next`; excluded from the stable plugin catalog. |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | Model Hub: edit model fields exposed by installed plugin settings. | Release candidate on `next`. |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | Session Manager: find sessions and read conversations across working directories. | Release candidate on `next`; advanced thread actions need the supplied host patch. |

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

`scripts/npm-release-holds.json` records packages awaiting acceptance. Both planning and publishing enforce the list, including previously saved plans. Before removing a package, review its final archive, pass relevant checks, and accept new behavior in the target DSH host, including bundled workspace dependencies. Private development packages still participate in builds and tests.

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
