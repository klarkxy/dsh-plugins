# Web Search

<!-- release-state-note -->

[简体中文](README.md) / English

Manage and rank web search and page-reading providers, configure request limits, and expose `web_search` and `web_fetch` to the model from one settings page.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name, restart DSH Web, and open **Settings → Web Search**. Restart the profile after plugin updates as well so the latest search code loads.

## Usage

### Search (`web-search` tab)

- **Zero-config provider**: **DuckDuckGo** works out of the box without registration or an API key.
- **Key-based providers**: Enter and save an API key to use **DeepSeek search** (shares the key configured for model settings), **Exa**, **Brave**, **Bocha**, **Serper**, **Firecrawl**, **Tavily**, **Perplexity**, **You.com**, **Linkup**, or **Zhipu**.
  - **Perplexity**: calls the Search API to return web sources directly without generating an answer.
  - **You.com**: returns web and news snippets directly without extra full-page extraction.
  - **Linkup**: uses `fast` retrieval and returns sources only, with no generated answer or `deep` search.
  - **Tavily**: stays on `basic` search and never upgrades search depth automatically.
  - **Zhipu**: stays on basic search (`search_std`); queries longer than 70 characters are rejected locally instead of being truncated.
- **Plugin providers**: Search services contributed by other plugins (such as Zhihu Web Search) appear in the same list and join the priority order once switched on.
- **Priority and testing**: Drag rows or use the up/down arrow keys to reorder; each search uses the first ready, enabled service. When search is active, use **Test connection (may be billed)** to verify connectivity.

### Page Reading (`web-fetch` tab)

- Enable **Read web pages**, toggle on the services you want, and drag or use the up/down arrow keys to set priority; each fetch uses the first configured, available service.
- The bundled **Read web pages** service tries free anonymous **Jina Reader** first for public pages and falls back to one direct HTTP request if that fails.
- **Firecrawl** reads page Markdown using the same API key as Firecrawl search (search and page reads are billed separately).
- Fetch services from the host or other plugins also appear here and join the priority order once enabled; temporarily unloaded services retain their selection and rank.

### Request Limits (`Settings` tab)

- Configure **Max results/query** (1–20), **Max queries/call** (1–5), **Request timeout (ms)** (1000–120000), and **Max text chars** (1000–200000).
- Switches and order changes apply immediately; newly entered API keys and limit edits require clicking **Save**.

## Agent Tools

Add this entry to the plugin list in your `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model receives `web_search` and `web_fetch` while search and page reading are active with a ready backend.

## Limitations

- Paid providers may charge per request or credit; refer to your provider account for authoritative usage and billing.
- Both the bundled Jina Reader and Firecrawl page reading send requested URLs to those third-party services; use them only for public URLs free of private tokens or internal endpoints.
- Firecrawl page reading requires a page status code and final URL in the response and may return cached page content.
- Each search or page-read request runs against only the highest-ranked ready service and does not fail over across multiple paid backends.
- Cancellation and timeouts signal the active service to abort and wait for cleanup. A third-party service that ignores cancellation can delay results and plugin unloading, as code inside DSH stops cooperatively.

## License

[SATA License 2.1](LICENSE)
