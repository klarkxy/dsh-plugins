# dsh-plugins

[简体中文](README.zh-CN.md) / English

DeepSeek Harness (DSH) plugins by klarkxy. Browse them on the [plugin site](https://klarkxy.github.io/dsh-plugins/), which shows install commands and each plugin's documentation.

## Plugins

| Package | What it does |
| --- | --- |
| [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/README.md) | Auto Title: session titles follow the latest task; names you set by hand stay put. |
| [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/README.md) | Git Commit: commit workspace changes from the conversation, with the model grouping the commits. |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: an independent reviewer model vets each sandbox escalation; only a pass auto-approves. |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | Session Manager: find and read sessions across working directories, copy thread IDs, and use temporary workspaces. |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | Model Hub: change the models used by your plugins and subagents from one page. |
| [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/README.md) | Web Search: manage web search providers and public-page reading from one settings page. |
| [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/README.md) | Zhihu: Zhihu search, agent tools, knowledge bases, and usage tracking. |
| [`@klarkxy/dsh-chatgpt`](plugins/dsh-chatgpt/README.md) | ChatGPT: search, image creation and editing, and image understanding through your local Codex. |
| [`@klarkxy/dsh-grok-build`](plugins/dsh-grok-build/README.md) | Grok Build: search, page reading, images, and video through your local Grok Build CLI. |
| [`@klarkxy/dsh-minimax-code`](plugins/dsh-minimax-code/README.md) | MiniMax Code: search, images, video, speech, and audio/video understanding through your local MiniMax Code. |
| [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | Font: customize the interface font, code font, and conversation font size of the Web GUI. |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.md) | Unrestricted: a session preset that delivers complete results, only in sessions that pick it. |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: read the official DSH docs in the Plugins page; Creator mode can look up docs and plugins. |
| [`dsh-plugin-autoevo`](https://github.com/klarkxy/dsh-plugin-autoevo#readme) | AutoEvo (deprecated): find, review, and install reusable capabilities; no longer maintained (separate repository). |

`@klarkxy/dsh-plugin-kit` and `@klarkxy/dsh-model-route` are shared libraries that other plugins install automatically.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart the profile after installing. Plugins that depend on others list the full install order on their site page.

## Development

Requires Node.js 24+ and pnpm 10.

```bash
pnpm install
pnpm check
```

The code is the developer documentation. Releases follow the [release guide](RELEASING.md).

## Plugin lifecycle

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
