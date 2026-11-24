# dsh-plugins

[简体中文](README.md) / English

DeepSeek Harness (DSH) plugins by klarkxy. Browse the [plugin site](https://klarkxy.github.io/dsh-plugins/en/) for install commands, release timelines, and full documentation.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart the profile after installing; required shared libraries are installed automatically.

To browse the plugin list in DSH, enable the experimental **Custom Plugin Market** bundle, then choose **Plugins → Discover → Add index source** and enter:

```text
https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/index.json
```

<!-- plugin-release-states:start -->
## Plugins

| Category | Package | What it does |
| --- | --- | --- |
| How the agent works | [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/README.en.md) | **Git Commit**: Commit workspace changes from the conversation, with the model grouping commits and generating commit messages. |
| How the agent works | [`@klarkxy/dsh-delegation`](plugins/dsh-delegation/README.en.md) | **Delegation Mode**: Per-session Delegation Mode: the main agent plans, delegates, and reviews while subagents carry out the work, enabling multi-agent orchestration. |
| How the agent works | [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.en.md) | **Safe Auto**: Adds a Safe Auto approval level: a reviewer model answers approval requests one call at a time, with full review history and audit trails. |
| How the agent works | [`@klarkxy/dsh-font`](plugins/dsh-font/README.en.md) | **Font**: Customize the interface, conversation, code and terminal fonts and font sizes of the Web GUI; change font families and adjust typography. |
| How the agent works | [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.en.md) | **Unrestricted**: A session preset that removes the model's answer limits and delivers complete results, only in sessions that pick it; may get your account banned. |
| How the agent works | [`@klarkxy/dsh-deep-view`](plugins/dsh-deep-view/README.en.md) | **Deep View intelligent UI**: Compose native visuals, interactive math, node graphs, data exploration, maps and adjustable estimates inside replies, then turn interactions into answers. |
| How the agent works | [`@klarkxy/dsh-secret-manager`](plugins/dsh-secret-manager/README.en.md) | **Secret Manager**: Collect and manage secrets securely outside chat with per-session usage limits. |
| How the agent works | [`@klarkxy/dsh-prompt-override`](plugins/dsh-prompt-override/README.en.md) | **Prompt Override**: Adds a working contract to DSH's native system prompt and rewrites its terse built-in tool guidance, in every session. |
| Sessions and memory | [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/README.en.md) | **Auto Title**: Session titles follow the latest task automatically; names you set by hand stay put. Auto-rename and manual naming coexist. |
| Sessions and memory | [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.en.md) | **Session Manager**: Search and read DeepSeek Harness sessions across working directories, use temporary workspaces, continue with one tap or automatically when a reply stops early, recap on return with context-compaction hints, and optionally let the agent fork the current session or message other sessions. |
| Sessions and memory | [`@klarkxy/dsh-context-cleaner`](plugins/dsh-context-cleaner/README.en.md) | **Context Cleaner**: Hides the plugin-info and promotion cards at the top of the dsh-context dashboard. |
| Sessions and memory | [`@klarkxy/dsh-workspace-folders`](plugins/dsh-workspace-folders/README.en.md) | **Workspace Folders**: Add multiple folders to each workspace and use them together in Agent conversations. |
| Models and the web | [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/README.en.md) | **Web Search**: Orchestrate multi-source web search (parallel RRF fusion, failover, single; DuckDuckGo, Exa, Tavily, Brave, Bocha, Serper, Linkup, Zhipu, and plugin sources) and waterfall page reading (Jina Reader and plugin sources) in one settings page for web_search and web_fetch. |
| Models and the web | [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/README.en.md) | **Zhihu**: Search Zhihu and the web, browse hot lists, Zhida, knowledge bases, Q&A, creator data, and drafts, and export local reports for deep research, opinion comparison, and rolling 30-day briefings. |
| Models and the web | [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/README.en.md) | **Subagents**: Configure subagent models and reasoning effort, review their last-used models, and enable Delegation Mode per session. |
| Models and the web | [`@klarkxy/dsh-model-picker`](plugins/dsh-model-picker/README.en.md) | **Model picker**: Pick a model and reasoning effort in the composer from periodic-table style cards or a searchable list; other plugins can reuse it. |
| Plugin development | [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.en.md) | **DSH Docs**: Browse official DSH developer documentation in the Plugins page; in Creator mode the agent also gets two read-only tools to search docs and inspect plugins across the catalog, npm, and GitHub (dsh_docs, dsh_plugins). |
| Plugin development | [`@klarkxy/dsh-update`](plugins/dsh-update/README.en.md) | **Update and Changelog Preview**: Intercepts automatic version downloads and adds plugin-level updates: preview the release changelog across the version range first, then apply after confirmation. |

Shared libraries: [`@klarkxy/dsh-plugin-kit`](plugins/dsh-plugin-kit/README.en.md) (Plugin Kit) and [`@klarkxy/dsh-model-route`](plugins/dsh-model-route/README.en.md) (Model Route), installed automatically by dependent plugins.

## Plugin lifecycle

Published cataloged packages listed above follow the normal update workflow; the table below lists only packages outside that catalog:

| Package | Lifecycle | Notes |
| --- | --- | --- |
| [@klarkxy/dsh-quick-review](plugins/dsh-quick-review/README.en.md) | Testing (`testing`) | Read-only review session and sidebar tab passed first-release acceptance; the first npm release goes through the manual first_release workflow. |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.en.md) | Draft (`draft`) | New shortcut manager and extensible command palette; awaiting first-release acceptance. |
| [@klarkxy/dsh-sidebar-layout](plugins/dsh-sidebar-layout/README.en.md) | Published (`published`) | Published on npm; subsequent versions follow the normal update workflow. |
<!-- plugin-release-states:end -->

## Downloads

Daily npm downloads across all plugins (from the official npm statistics, refreshed every day; counts include CI and mirror traffic and are best read relatively):

[![Daily npm downloads across all klarkxy DSH plugins](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-all.svg)](https://www.npmjs.com/~klarkxy)

## Development

Requires Node.js 24+ and pnpm:

```bash
pnpm install
pnpm check
```

The code is the developer documentation. See the [contributing guide](CONTRIBUTING.en.md) and [release guide](RELEASING.md).

## License

[SATA License 2.1](LICENSE)
