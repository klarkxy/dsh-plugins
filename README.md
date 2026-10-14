# dsh-plugins

[简体中文](README.zh-CN.md) / English

A small pnpm monorepo for focused DeepSeek Harness plugins and shared libraries that do not need a repository of their own. Each package under `plugins/` tests and releases on its own; bundles and native presets install through DSH.

The current workspace targets DSH **0.2.0-rc.2**, with Cordis **4.0.4** and Schemastery **3.18.4**. Development dependencies are pinned together; installed plugins use open host compatibility ranges and optional DSH peers. This source baseline does not change the versions already published on npm.

This README also catalogs klarkxy's public DSH plugins on npm, including packages maintained in other repositories. The browsable version is the [plugin site](https://klarkxy.github.io/dsh-plugins/). List preview releases in both READMEs; add a DSH plugin to `site/catalog.json` once npm has its `latest` release.

## Published plugins

Package names link to npm or the package README; the last column provides the other entry point. Follow each plugin's documentation for installation, host compatibility, and configuration.

| Package | Purpose | Docs / npm |
| --- | --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: read official DSH docs in the Plugins page; Creator mode searches docs and checks plugin npm metadata with native tools. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-dev-index) |
| [`@klarkxy/dsh-current-title`](https://www.npmjs.com/package/@klarkxy/dsh-current-title) | Auto Title: session titles follow the latest task; manual names stay put. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title#readme) |
| [`@klarkxy/dsh-web-search-manager`](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) | Web Search: manage web search providers and public-page fetching from one settings page. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-web-search-manager#readme) |
| [`@klarkxy/dsh-zhihu`](https://www.npmjs.com/package/@klarkxy/dsh-zhihu) | Zhihu: Zhihu search, agent tools, knowledge bases, and usage tracking. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-zhihu#readme) |
| [`@klarkxy/dsh-git-commit`](https://www.npmjs.com/package/@klarkxy/dsh-git-commit) | Git Commit: commit workspace changes from the conversation header, with model-planned commit groups. | [Docs](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-git-commit#readme) |
| [`dsh-plugin-autoevo`](https://www.npmjs.com/package/dsh-plugin-autoevo) | Discover, review, and install reusable capabilities. | [Docs](https://github.com/klarkxy/dsh-plugin-autoevo#readme) |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: an independent reviewer vets each sandbox escalation; only a pass auto-approves. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-safe-auto) |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | Session Manager: find sessions and read conversations across working directories; advanced thread actions need the supplied host patch. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-session-manager) |
| [`@klarkxy/dsh-chatgpt`](plugins/dsh-chatgpt/README.md) | ChatGPT tools: search, image generation/editing, and vision through the official local Codex runtime. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-chatgpt) |
| [`@klarkxy/dsh-grok-build`](plugins/dsh-grok-build/README.md) | Grok Build: search, fetch, images, and video through the official local CLI. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-grok-build) |
| [`@klarkxy/dsh-minimax-code`](plugins/dsh-minimax-code/README.md) | MiniMax Code: media creation, transcription, and understanding through official tools. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-minimax-code) |
| [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | Font: customize the interface font, code font, and conversation font size of the Web GUI. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-font) |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | Model Hub: edit model fields exposed by installed plugin settings. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-model-hub) |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.md) | Unrestricted: a session preset that answers under the unrestricted delivery contract, only in sessions that pick it. | [npm](https://www.npmjs.com/package/@klarkxy/dsh-unrestricted) |


## Install

Published plugins install with the DSH plugin manager, which pulls the package from the npm registry:

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
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

Requires Node.js 24 or newer (26 verified; 26 is not yet LTS) and pnpm 10.

```bash
pnpm install
pnpm check
```

Each package owns its assets, tests, and release version. Native presets need no runtime plugin or build. The repository root is not a DSH bundle.

## Plugin lifecycle

Packages move through an irreversible lifecycle: Draft → Testing → Published. See the [release guide](RELEASING.md) for the full rules.

<!-- plugin-release-states:start -->
| Package | Lifecycle | Notes |
| --- | --- | --- |
| [@klarkxy/dsh-chatgpt](plugins/dsh-chatgpt/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-grok-build](plugins/dsh-grok-build/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-minimax-code](plugins/dsh-minimax-code/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
<!-- plugin-release-states:end -->


## License

[SATA License 2.1](LICENSE)

## Editor public-plugin extraction

Portable packages extracted from Editor are now maintained under `plugins/`, keeping their package names, tool behavior, and persisted settings; Zhihu swaps its private UI dependency for a package-local structural control adapter. Manuscript, proofread, and application-private packages remain in Editor, and desktop preinstallation and offline startup are unchanged. Details, including the handoff and validation record, are in [the migration document](docs/editor-plugin-migration.md).
