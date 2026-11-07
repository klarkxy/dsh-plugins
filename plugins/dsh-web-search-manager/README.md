# Web Search

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Pick which service answers the model's web searches, set request limits, and let it read public pages — from one settings page with separate tabs for search, page reading, and request limits.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name. Restart DSH Web, then open **Settings → Web Search**. Restart the profile after plugin updates as well so the new search code loads.

## Set up search

DuckDuckGo works out of the box with zero configuration. To use DeepSeek Search, Exa, Brave, Bocha, Serper, Firecrawl, Tavily, Perplexity, or You.com, enter its API key. Drag the list to reorder: each search uses the first ready service. Search services from other plugins, such as Zhihu, appear in the same list and join the priority order once you enable them.

The **Settings** tab sets the number of results, queries per call, total timeout, and maximum page length.

## Read web pages

Turn on **Read web pages**, enable the services you want, then drag them or use the up/down arrow keys to set priority. Each fetch uses the first configured, available service. Fetch services from other plugins also appear and join the priority order once enabled; temporarily unloaded services keep their selection and position.

Your previously selected fetch service stays first. The bundled **Read web pages** service uses the free Jina Reader and falls back to one direct request if that fails; services from the host or other plugins use their own fetching method.

**Firecrawl** can also read Markdown pages with the same API key as Firecrawl search; search and page reads are billed separately. Perplexity uses its Search API to return search results directly; You.com returns web and news snippets directly.

## Give the tools to the model

Add this to the plugin list of your `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model then gets `web_search` and `web_fetch` while search and fetch are on.

## Limits

- Paid services may charge per search or fetch; refer to your provider account for billing.
- The bundled Jina Reader sends page addresses to Jina; use it only for public URLs free of private tokens.
- Firecrawl page reads require a page status code and final URL in the response, and may serve cached page content. URLs are sent to the selected fetch service.
- Each search or fetch request runs against the selected active service only.
- Cancellation and timeouts ask the active service to stop and wait for it to finish cleaning up. A third-party service that ignores cancellation can delay results and plugin unloading, as code running inside DSH finishes cooperatively.

## License

[SATA License 2.1](LICENSE)
