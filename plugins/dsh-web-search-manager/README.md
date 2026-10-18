# Web Search

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Choose which service answers the model's web searches, set request limits, and let the model read public web pages — all from one settings page, with a tab each for search, page reading, and request limits.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name, restart DSH Web, and open **Plugins → Web Search**. Restart DSH after plugin updates too; refreshing the page alone does not load updated search code.

## Set up search

DuckDuckGo works out of the box with no key. You can also enable DeepSeek Search, Exa, Brave, Bocha, Serper, Firecrawl, Tavily, Perplexity, or You.com by entering their API keys. Drag the list to set the order; each search uses the first ready service. Search services added by other plugins, such as Zhihu, appear in the same list. New services are not enabled automatically.

The **Settings** tab sets the number of results, queries per call, the total timeout, and the maximum page length.

## Read web pages

Turn on **Read web pages**, enable the services you want to use, and drag them or use the up/down arrow keys to set their priority. Each fetch uses the first configured, available service. Fetch services connected by other plugins also appear in the list; new services need to be enabled manually. Services that are temporarily unloaded keep their selection and position.

Your previously selected fetch service is kept as the first entry. The bundled **Read web pages** service uses the free Jina Reader, falling back to one direct request if that fails. Services supplied by the host or other plugins use their own fetching method.

You can also enable **Firecrawl** to read Markdown pages with the same API key as Firecrawl search. Search and page reads are billed separately. Newly added services stay outside your priority lists until you enable them. Perplexity uses its Search API without generating answers; You.com returns web and news snippets without requesting extra full-page extraction.

## Give the tools to the model

Add this to the plugin list of the `agent.cordis.yml` you use:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model then gets `web_search` and `web_fetch` while search and fetch are turned on.

## Limits

- Paid services may charge for search or fetch requests; the plugin's counts are not a bill.
- When using the bundled Jina Reader, page addresses are sent to Jina; do not fetch URLs containing private tokens.
- Firecrawl page reads require a page status code and final URL in the service response; missing metadata produces an error. Its page content may come from the service's cache. URLs are sent to the selected fetch service.
- Failed search or fetch requests do not switch to another service in the list automatically.
- Cancellation and timeouts ask the active service to stop and wait for it to finish cleaning up. A third-party service that ignores cancellation can delay the result and plugin unloading; the plugin cannot forcibly stop code running inside DSH.

## License

[SATA License 2.1](LICENSE)
