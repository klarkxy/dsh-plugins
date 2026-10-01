# @klarkxy/dsh-web-search-manager

Choose which service answers the agent's web searches, set the limits every request runs under, and let the agent read public pages — all from one settings page.

[简体中文](docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No repository build is needed.

## Install

```sh
npm install @klarkxy/dsh-web-search-manager
```

Then load it:

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Restart DSH Web and open **Plugins → Web search**.

## Configure search

The settings page has two tabs: **搜索服务** manages the providers, **请求限制** sets the request limits. DuckDuckGo is enabled by default and needs no key. To add another backend, enable it and fill in its credentials in settings; one ready backend is enough. Drag the list to change the order, and each request is served by the first ready backend in that order. A backend whose key is missing is skipped, and a failed request does not silently move on to another one.

Built-in search backends:

- **DuckDuckGo**: no registration and no key; the default backend, free of charge.
- **DeepSeek 搜索**: shares the DeepSeek API key from model settings (`DEEPSEEK_API_KEY`); may incur additional search charges on top of model usage.
- **Exa**: an independent Search API; requires its own key (`DSH_EDITOR_WEB_EXA_API_KEY`). The Exa provider is declared as a runtime dependency of this plugin.
- **Brave**: the Brave Search API; requires `DSH_EDITOR_WEB_BRAVE_API_KEY`.
- **博查**: a Chinese web search API; requires `DSH_EDITOR_WEB_BOCHA_API_KEY`.
- **Serper**: a Google results API; requires `DSH_EDITOR_WEB_SERPER_API_KEY`.
- **Firecrawl**: a web search and extraction API; requires `DSH_EDITOR_WEB_FIRECRAWL_API_KEY`.
- **Tavily**: a Search API fixed to basic search depth, never auto-upgraded; requires `DSH_EDITOR_WEB_TAVILY_API_KEY`. The adapter is built into this plugin; the former standalone `dsh-web-search-tavily` package is retired.

## Read public pages

Turning search on also enables public-page fetching. The built-in `http` route first requests `https://r.jina.ai/<target URL>` anonymously and returns Reader's text/Markdown. HTTP errors (including 429), Reader timeouts, network failures, and empty or invalid responses fall back once to the existing direct HTTP fetcher. This fallback covers page fetching only; it does not change how a search backend is picked. No Jina registration, API key, billing configuration, or new dependency is required.

The request carries no cookies or authorization headers. IP literals, obvious local hostnames, credentialed URLs, and URLs that already carry the Reader prefix skip Jina and stay subject to the original HTTP fetcher's policy. Both stages use the existing HTTP transport, and the Reader stage takes at most half of `timeoutMs`, capped at 15 seconds, so a direct fallback still has time to run. Caller cancellation, disabled network access, or an overall deadline stops the request without starting a fallback. Results keep the requested URL rather than the Reader proxy URL.

## Request limits

The limits cap each query's results (`maxResults`), queries per tool call (`maxQueries`), the total request timeout (`timeoutMs`), and fetched page characters (`maxFetchChars`). Each HTTP response retains the 5 MB byte cap. A connection test sends a fixed query, not manuscript content, and may incur a provider charge.

## Agent tools

For agent access, add this entry to the plugin list in the `agent.cordis.yml` you use:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

Once that entry is enabled, the agent receives the official `web_search` and `web_fetch` tools from `@deepseek-ai/dsh-tool-web`, mounted only while search and fetching are enabled.

## Extend or develop

Use DSH's existing `ctx.web` service. For a provider extension, see [manager contracts](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/contracts.ts), [built-in registration](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/builtins.ts), and the [Tavily adapter](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/src/tavily.ts). Forward cancellation signals; `available()` must check local state without a network request. Provider extensions can supply `pricing`, an HTTPS `pricingUrl`, and `credentialHint` for a shared credential in their registration metadata.

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-web-search-manager typecheck
pnpm --filter @klarkxy/dsh-web-search-manager test
pnpm --filter @klarkxy/dsh-web-search-manager build
```

Tests use mock credentials and responses and incur no search charges.

## Boundaries and limits

- Only configure trusted HTTPS endpoints: API keys are sent to them.
- Credentials are kept in DSH storage, and protection at rest depends on its configured backend.
- Usage counters are call attempts, not billing statements or a spending cap.
- Target URLs are sent to Jina, a third-party service; do not submit URLs containing private tokens or other sensitive data.
- Disabling a managed provider cancels its requests, but it does not sandbox HTTP calls made directly by other plugins.
- Search results are external material and cannot authorize changes to manuscripts.
- If deployment environment overrides conflict with the settings selection, remove the conflicting overrides.
- If saving the configuration fails, managed network access pauses until the settings are saved successfully.

[Publishing](../PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
