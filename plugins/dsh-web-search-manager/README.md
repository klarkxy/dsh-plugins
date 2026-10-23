# Web Search

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Pick which service answers the model's web searches, set request limits, and let it read public pages — from one settings page with separate tabs for search, page reading, and request limits.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name. Restart DSH Web, then open **Plugins → Web Search**. Restart after plugin updates too; refreshing the page alone does not load new search code.

## Set up search

DuckDuckGo works out of the box, no key needed. To use DeepSeek Search, Exa, Brave, Bocha, Serper, Firecrawl, Tavily, Perplexity, or You.com, enter its API key. Drag the list to reorder: each search uses the first ready service. Search services from other plugins, such as Zhihu, appear in the same list. New services are not enabled automatically.

The **Settings** tab sets the number of results, queries per call, total timeout, and maximum page length.

## Read web pages

Turn on **Read web pages**, enable the services you want, then drag them or use the up/down arrow keys to set priority. Each fetch uses the first configured, available service. Fetch services from other plugins also appear; new ones must be enabled manually. Temporarily unloaded services keep their selection and position.

Your previously selected fetch service stays first. The bundled **Read web pages** service uses the free Jina Reader and falls back to one direct request if that fails; services from the host or other plugins use their own fetching method.

**Firecrawl** can also read Markdown pages with the same API key as Firecrawl search; search and page reads are billed separately. Newly added services stay outside your priority lists until you enable them. Perplexity uses its Search API without generating answers; You.com returns web and news snippets without extra full-page extraction.

## Give the tools to the model

Add this to the plugin list of your `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model then gets `web_search` and `web_fetch` while search and fetch are on.

## Limits

- Paid services may charge per search or fetch; the plugin's counts are not a bill.
- The bundled Jina Reader sends page addresses to Jina; do not fetch URLs with private tokens.
- Firecrawl page reads require a page status code and final URL in the response; missing metadata errors out. Its page content may come from the service's cache. URLs go to the selected fetch service.
- Failed search or fetch requests do not switch to another service automatically.
- Cancellation and timeouts ask the active service to stop and wait for it to finish cleaning up. A third-party service that ignores cancellation can delay results and plugin unloading; the plugin cannot forcibly stop code running inside DSH.

## License

[SATA License 2.1](LICENSE)
