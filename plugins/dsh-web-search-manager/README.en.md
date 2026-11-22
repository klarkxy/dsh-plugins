# Web Search

<!-- release-state-note -->

[简体中文](README.md) / English

Orchestrate multi-source web search and page-reading providers, manage API keys and request limits, and power `web_search` and `web_fetch` over `ctx.web` with parallel RRF fusion and waterfall fallback from one settings page.

## Demo

![Web search settings: fusion / failover / single modes, fetch waterfall, and billing opt-ins](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr23-web-search-manager.gif)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name, restart DSH Web, and open **Settings → Web Search**. Restart the profile after plugin updates as well so the latest search code loads.

## Usage

### Search (`web-search` tab)

- **Three orchestration modes** (applied immediately):
  - **Parallel fusion** (default): queries top-ranked free sources concurrently, strips tracking parameters for URL canonicalization, deduplicates and reranks results via weighted Reciprocal Rank Fusion (RRF), and merges richer summaries, snippets, and publication dates. Equivalent DeepSeek search backends are grouped automatically so the same index is never queried twice in one call.
  - **Failover**: tries enabled sources in rank order and falls back to the next permitted source when an upstream fails or is unavailable.
  - **Single**: queries only the highest-ranked ready source with no cross-source fan-out or fallback.
- **Billing guardrails**: Sources without per-call tool fees (such as bundled **DuckDuckGo**, host **DeepSeek Search API**, and **DeepSeek search**) join parallel fusion and failover automatically. Per-request or credit-billed providers and unclassified third-party plugin sources require checking **Allow in multi-source fan-out / fallback (may bill per call)** on their row before joining fan-out or fallback chains. If an un-opted paid source is ranked first, it runs alone as your primary choice.
- **Bundled search backends**:
  - **DuckDuckGo**: works out of the box without registration or an API key.
  - **Key-based providers**: enter and save an API key to use **DeepSeek search** (shares the key configured for model settings), **Exa**, **Brave**, **Bocha**, **Serper**, **Firecrawl**, **Tavily**, **Perplexity**, **You.com**, **Linkup**, or **Zhipu**.
    - **Perplexity**: calls the Search API to return web sources directly without generating an answer.
    - **You.com**: returns web and news snippets directly without extra full-page extraction.
    - **Linkup**: uses `fast` retrieval and returns sources only, with no generated answer or `deep` search.
    - **Tavily**: stays on `basic` search and never upgrades search depth automatically.
    - **Zhipu**: stays on basic search (`search_std`); queries longer than 70 characters are rejected locally instead of being truncated.
- **Host and plugin providers**: Built-in host search services and search providers registered by other plugins (such as Zhihu Web Search) appear in the same list and join the priority order once switched on. When search is active, use **Test connection (may be billed)** to verify connectivity.

### Page Reading (`web-fetch` tab)

- **Two fetch modes** (applied immediately):
  - **Waterfall** (default): tries enabled fetch services in priority order, automatically advancing to the next permitted service on network or cross-origin redirect errors, non-success HTTP status codes, or empty page bodies.
  - **Single**: uses only the highest-ranked ready fetch service.
- **Bundled and host fetch services**:
  - **Jina Reader** and **Read web pages**: extract public page Markdown via free anonymous Jina Reader first and fall back to direct local HTTP when needed; no API key required.
  - **Firecrawl**: reads page Markdown using the same API key as Firecrawl search (search and page reads are billed separately; check the row opt-in box to include it in waterfall fallback).
  - **Local and intranet URL protection**: requests targeting `localhost`, loopback addresses, private RFC1918/CGNAT/ULA ranges, or local-only hostnames automatically bypass cloud reader services (such as DeepSeek Fetch API, Jina Reader, and Firecrawl) and use direct local HTTP only.

### Request Limits (`Settings` tab)

- Configure **Max results/query** (1–20, default 10), **Max queries/call** (1–10, default 10), **Max parallel sources** (2–5, default 3), **Request timeout (ms)** (1000–120000), and **Max text chars** (1000–200000).
- Switches, mode selections, billing opt-ins, and order changes apply immediately; newly entered API keys and limit edits require clicking **Save**.

## Agent Tools

Presets that already include the host `tool-web` plugin automatically use this orchestrator through `ctx.web`. For custom `agent.cordis.yml` files without `tool-web`, add:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model receives `web_search` and `web_fetch` while search and page reading are active with a ready backend.

## Limitations

- Paid providers may charge per request or credit; enabling **Allow in multi-source fan-out / fallback** sends live requests to opted-in providers during parallel search or fallback, and your provider account remains authoritative for billing.
- Cloud page-reading services (such as DeepSeek Fetch API, Jina Reader, and Firecrawl) receive the requested public URL; do not use them for URLs carrying private capability tokens.
- Firecrawl page reading requires a page status code and final URL in the response and may return cached page content.
- Cancellation and timeouts signal all active providers to abort and wait for cleanup. A third-party service that ignores cancellation can delay results and plugin unloading, as code inside DSH stops cooperatively.

## License

[SATA License 2.1](LICENSE)
