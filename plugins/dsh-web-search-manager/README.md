# @klarkxy/dsh-web-search-manager

Choose which service answers the agent's web searches, set the limits every request runs under, and let the agent read public pages — all from one settings page.

[简体中文](docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.2.0-rc.2`. No repository build is needed.

## Install

Install the published package into the target profile:

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name. Restart DSH Web and open **Plugins → Web search**. To uninstall, run `dsh plugin --profile web remove @klarkxy/dsh-web-search-manager`.

## Configure search

The settings page has two tabs: **搜索服务** manages the providers, **请求限制** sets the request limits. DuckDuckGo is enabled by default and needs no key. To add another backend, enable it and fill in its credentials in settings; one ready backend is enough. Drag the list to change the order, and each request is served by the first ready backend in that order. A backend whose key is missing is skipped, and a failed request does not silently move on to another one.

Each row shows local availability (**Available** / **Unavailable**), whether it participates in the order (the switch), and **In use** only for the first ready backend that is actually serving requests. Availability is the local `available()` / credential state, not a billed test. Saved order ids that are not registered stay in place as **Not loaded; selection kept** until you turn that switch off; ordinary search toggles, reordering, and key/limit saves do not drop them, and clearing the order does not revive DuckDuckGo.

The manager discovers search and fetch providers in this profile’s `ctx.web`, including official and custom plugins registered before or after it starts. Newly discovered providers do not join the enabled search order automatically. The page refreshes registration and local availability about every three seconds while it is visible, and stops when it is hidden or unmounted. External providers keep their configuration and credentials in their own plugin. If they supply a safe `configurationUrl` (HTTPS, a same-host `/…` path, or a `#…` hash), this page links to it; otherwise it names the configuration owner, or asks you to configure the service in its plugin. This page does not guess host routes from an id or owner, and it does not edit those credentials.

Bundled adapters register natively too. If the official DeepSeek/HTTP id is absent at startup, fallback adapters use `deepseek-managed` / `http-managed`, allowing official providers to register later. Existing choices and endpoints for the old bundle-owned ids migrate in memory without a request or storage write; the next explicit save persists them. If a native provider already owns an old id, its own settings apply and any unchanged old manager endpoint remains stored without being forwarded to that provider.

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

Web page fetching has its own switch and selector. If the host already registers `http`, its native fetch behavior and configuration are used. Otherwise this bundle supplies `http-managed`, the existing Jina-first adapter. That adapter first requests `https://r.jina.ai/<target URL>` anonymously and returns Reader's text/Markdown. HTTP errors (including 429), Reader timeouts, network failures, and empty or invalid responses fall back once to the existing direct HTTP fetcher. This fallback covers page fetching only; it does not change how a search backend is picked. No Jina registration, API key, billing configuration, or new dependency is required.

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

Provider plugins call `ctx.web.registerSearchProvider(provider)` or `ctx.web.registerFetchProvider(provider)` directly, with no dependency on `webSearchManager`. Keep `available()` local, forward cancellation signals, and resolve configuration and credentials in the provider. Optional `dshWebManagement` display metadata on the provider can include `label`, `description`, `billing`, `configurationOwner`, `credentialHint`, `pricing`, an HTTPS `pricingUrl`, and an explicit `configurationUrl`. `configurationUrl` is the only settings link: HTTPS, a same-host `/…` path, or a `#…` hash. Do not expect this page to invent a route from `id` or `configurationOwner`. `credentialHint` is display text only. Providers without metadata are discovered under their id. Description and pricing from the provider win over any bundled notes with the same id; bundled adapters may still fall back to their known price list. Native services without pricing metadata show that none was provided. Metadata never contains credential values. The old manager factory methods remain as deprecated compatibility adapters; new plugins use native registration.

```ts
const provider = {
  id: 'my-search',
  dshWebManagement: {
    id: 'my-search', label: 'My search', description: 'Custom search service',
    billing: 'request', configurationOwner: '@example/my-plugin',
    configurationUrl: '/plugins/my-plugin',
  },
  available: () => locallyConfigured(),
  search: (request, signal) => searchWithOwnConfiguration(request, signal),
}
ctx.web.registerSearchProvider(provider)
```

DSH 0.2.0-rc.2 has no public registry enumeration or dynamic selection API. This package isolates a compatibility bridge in `web-registry.ts`: it observes the actual host Maps, manages availability and temporarily takes over selection, then restores provider instances and prior config/environment selection on unload. Unsupported host structures fail explicitly instead of omitting providers. Providers can announce local availability changes through the repository extension event `web/provider-availability-updated` (arguments: `search`/`fetch`, id); this is not an official DSH event. Status refreshes and execution also recheck `available()`. After saving migrated adapter ids, downgrading the manager requires reselecting the old routes; credential references and legacy endpoint keys remain stored.

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
- While the manager is attached, saved manager selection applies; unloading restores the host’s original config/environment selection.
- If saving the configuration fails, managed network access pauses until the settings are saved successfully.

[Publishing](../PUBLISHING.md) · [License](https://github.com/klarkxy/dsh-editor/blob/main/packages/dsh-web-search-manager/LICENSE)
