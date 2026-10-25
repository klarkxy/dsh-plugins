# dsh-plugins

[简体中文](README.zh-CN.md) / English

DeepSeek Harness (DSH) plugins by klarkxy. Browse them on the [plugin site](https://klarkxy.github.io/dsh-plugins/), which shows install commands and each plugin's documentation.

## Plugins

| Package | What it does |
| --- | --- |
| [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/README.md) | Auto Title: session titles follow the latest task; names you set by hand stay put. |
| [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/README.md) | Git Commit: commit workspace changes from the conversation, with the model grouping the commits. |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: a reviewer model answers approval requests; only calls that pass go ahead. |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | Session Manager: find and read sessions across working directories, use temporary workspaces, continue with one tap on an empty composer, and get a welcome-back recap after time away. |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | Model Hub: change the models used by your plugins and subagents from one page, and see each running subagent's model and reasoning effort. |
| [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/README.md) | Web Search: manage and rank search and page-reading services, including providers from installed plugins, in one settings page. |
| [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/README.md) | Zhihu: Zhihu search, agent tools, knowledge bases, usage tracking, and draft management. |
| [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | Font: customize the interface font, code font, and conversation font size of the Web GUI. |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.md) | Unrestricted: a session preset that removes the limits on what the model answers and delivers complete results, only in sessions that pick it; may get your account banned. |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: read the official DSH docs in the Plugins page; Creator mode can look up docs and plugins on npm and GitHub. |

`@klarkxy/dsh-plugin-kit` and `@klarkxy/dsh-model-route` are shared libraries that other plugins install automatically.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart the profile after installing. The shared libraries a plugin depends on are installed along with it.

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
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.md) | Draft (`draft`) | New shortcut manager and extensible command palette; not yet published. |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
<!-- plugin-release-states:end -->

## License

[SATA License 2.1](LICENSE)
