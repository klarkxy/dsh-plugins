# dsh-plugins

[简体中文](README.zh-CN.md) / English

DeepSeek Harness (DSH) plugins by klarkxy. Browse them on the [plugin site](https://klarkxy.github.io/dsh-plugins/), which shows install commands and each plugin's documentation.

## Plugins

| Package | What it does |
| --- | --- |
| [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/README.md) | Auto Title: session titles follow the latest task automatically; names you set by hand stay put. Auto-rename and manual naming coexist. |
| [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/README.md) | Git Commit: commit workspace changes from the conversation, with the model grouping commits and generating commit messages. |
| [`@klarkxy/dsh-delegation`](plugins/dsh-delegation/README.md) | Delegation Mode: per-session switch where the main agent plans, delegates, and reviews while subagents carry out the work, enabling multi-agent orchestration. |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.md) | Safe Auto: adds a Safe Auto approval level where a reviewer model answers approval requests one call at a time, with full review history and audit trails. |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.md) | Session Manager: search and read DeepSeek Harness sessions across working directories, use temporary workspaces, continue with one tap or automatically when a reply stops early, recap on return with context-compaction hints, and optionally let the agent fork the current session or message other sessions. |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.md) | Subagents: configure the model and reasoning effort for new subagents, and see their last-used model in the conversation popup. |
| [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/README.md) | Web Search: manage and rank search and page-reading services, including Linkup, Zhipu and providers from installed plugins, in one settings page. |
| [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/README.md) | Zhihu: search Zhihu and the web, check hot lists, Zhida AI answers, Q&A, comments, knowledge bases, creator stats, and quotas, and manage article, question, and pin drafts with image uploads. |
| [`@klarkxy/dsh-font`](plugins/dsh-font/README.md) | Font: customize the interface, conversation, code and terminal fonts and font sizes of the Web GUI. |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.md) | Unrestricted: a session preset that removes the limits on what the model answers and delivers complete results, only in sessions that pick it; may get your account banned. |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | DSH Docs: browse official DSH developer documentation in the Plugins page; the agent gets two read-only tools to search docs and inspect plugins across the catalog, npm, and GitHub (`dsh_docs`, `dsh_plugins`). |
| [`@klarkxy/dsh-context-cleaner`](plugins/dsh-context-cleaner/README.md) | Context Cleaner: hides the plugin-info and promotion cards at the top of the dsh-context dashboard. |
| [`@klarkxy/dsh-deep-view`](plugins/dsh-deep-view/README.md) | Deep View: charts, metrics, tables and safe local inputs in replies, with validated answers to `show_view` cards. |
| [`@klarkxy/dsh-model-picker`](plugins/dsh-model-picker/README.md) | Model Picker: searchable model selection with a reasoning-effort slider in the composer; other plugins can reuse the same picker. |

`@klarkxy/dsh-plugin-kit` (runtime, UI and diagnostic logging helpers) and `@klarkxy/dsh-model-route` are shared libraries that other plugins install automatically.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart the profile after installing. The shared libraries a plugin depends on are installed along with it.

To browse the plugin list in DSH, enable the experimental **Custom Plugin Market** bundle, then choose **Plugins → Discover → Add index source** and enter:

```text
https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/index.json
```

The same source provides list updates. DSH asks for confirmation before installing any plugin.

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
| [@klarkxy/dsh-context-cleaner](plugins/dsh-context-cleaner/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-deep-view](plugins/dsh-deep-view/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-delegation](plugins/dsh-delegation/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-model-picker](plugins/dsh-model-picker/README.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-secret-manager](plugins/dsh-secret-manager/README.md) | Draft (`draft`) | New secret manager; host acceptance precedes the first release. |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.md) | Draft (`draft`) | New shortcut manager and extensible command palette; awaiting first-release acceptance. |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
| [@klarkxy/dsh-workspace-folders](plugins/dsh-workspace-folders/README.md) | Draft (`draft`) | New workspace folder management; host acceptance precedes the first release. |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | Published (`published`) | Published on npm; fixes, testing and version updates keep the Published lifecycle. |
<!-- plugin-release-states:end -->

## License

[SATA License 2.1](LICENSE)
