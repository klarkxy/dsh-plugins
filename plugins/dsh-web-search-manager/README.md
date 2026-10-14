# Web Search

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Choose which service answers the model's web searches, set request limits, and let the model read public web pages — all from one settings page.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-web-search-manager
```

Replace `web` with your profile name, restart DSH Web, and open **Plugins → Web Search**.

## Set up search

DuckDuckGo works out of the box with no key. You can also enable DeepSeek Search, Exa, Brave, Bocha, Serper, Firecrawl, or Tavily by entering their API keys. Drag the list to set the order; each search uses the first ready service. Search services added by other plugins, such as Zhihu, appear in the same list.

**Request limits** sets the number of results, queries per call, the total timeout, and the maximum page length.

## Read web pages

Turn on **Web fetch** to let the model read public pages. By default pages are read through the free Jina Reader, falling back to a direct request if that fails.

## Give the tools to the model

Add this to the plugin list of the `agent.cordis.yml` you use:

```yaml
- name: '@klarkxy/dsh-web-search-manager/tools'
```

The model then gets `web_search` and `web_fetch` while search and fetch are turned on.

## Limits

- Paid services may charge for searches; the plugin's counts are not a bill.
- Fetched page addresses are sent to Jina; do not fetch URLs containing private tokens.
- Failed searches do not switch to another service automatically.

## License

[SATA License 2.1](LICENSE)
