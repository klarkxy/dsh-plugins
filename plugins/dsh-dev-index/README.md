# DSH Docs

[简体中文](README.zh-CN.md) | [English](README.md)

Runtime: Node `^22.19.0 || >=24.0.0` and DSH `>=0.1.7-rc.2`. The documentation reader is a DSH Web client; the four read-only tools and the Creator-mode guidance run in the host.

Read the official DSH documentation without leaving DSH. The Plugins page embeds the official docs, and Creator mode also gets four native read-only tools: `dsh_docs_search` and `dsh_docs_fetch` to look up documentation, `dsh_plugins_search` and `dsh_plugins_fetch` to check a plugin's npm metadata. Installing and removing plugins stays with the official plugin manager; this plugin never installs anything.

In a running DSH, the same guidance points Creator mode at the read-only inspect tools `cordis_inspect_list` and `cordis_inspect_query`. The environment's own tool and approval policies still apply.

Readers use the [official documentation site](https://deepseek-harness.github.io/deepseek-harness/) (Chinese at the site root, English under `/en/`). Agents start from its [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt) index and fetch relevant raw Markdown pages. The site reflects the latest published release. For version-specific docs, source, and type declarations, use `master` in [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) only when it matches the target version; otherwise use the matching `dsh-v*` tag. Do not mix versions.

The plugin no longer ships or depends on a mirrored index. The [klarkxy Pages site](https://klarkxy.github.io/dsh-plugins/) is now a catalog of klarkxy's DSH plugins; its old index URLs redirect to the official site.

## Read in the Plugins page

In DSH Web, open **Plugins → DSH Docs**. The page shows the official GitHub Pages documentation in a reader panel: it opens the Chinese or English home page in the DSH interface language, offers a **中文 / English** switch, and links to the site in a separate tab. **Documentation home** reloads the home page of the language you are reading. If the embedded page does not load, the panel offers **Open in browser** and **Retry**.

## Creator mode guidance

The host half adds one system-prompt section when the session uses the `cordis` preset (Creator mode). It tells the agent to use `dsh_docs_search` and `dsh_docs_fetch` before choosing APIs, and `dsh_plugins_search` and `dsh_plugins_fetch` before installing or depending on a plugin. Other presets receive no extra prompt. All four read-only tools are registered with the host tool registry and remain subject to its tool policies. The plugin registers no skill.

- `dsh_docs_search({ query: "plugin", language: "en" })` searches the live official `llms.txt` directory: titles, categories and paths. This is a directory search, not full-text search; an empty result does not establish that a topic is absent from the document bodies, so try broader Chinese or English keywords.
- `dsh_docs_fetch({ id: "en/develop/basic/tool.md" })` reads a document ID returned by search. Results include the source URL, fetch time, content revision and `nextOffset`. Continue with that offset and the same `revision`; if the document changes, restart from offset zero. The default page size is 12,000 characters, at most 16,000.
- `dsh_plugins_search({ query: "memory" })` finds candidate plugins. The default `catalog` source searches the curated klarkxy Chinese/English plugin catalog; `source: "npm"` searches npm's `dsh-plugin` keyword more broadly. Neither source is exhaustive, and a hit is a candidate rather than verified compatibility.
- `dsh_plugins_fetch({ package: "@klarkxy/dsh-mood", version: "latest" })` reads npm registry metadata for an exact package name: dist-tags, published versions in publication-time order, and the selected version's bundle declaration, DSH/Node engine ranges, dependencies and deprecation. `version` accepts an exact release or a dist-tag; ranges are rejected.

The plugin-registry tools are read-only metadata lookups: nothing is downloaded, installed or executed, and a declared engines range is not runtime compatibility proof. GitHub-installed plugins have no registry metadata; install those directly with the official plugin manager as `github:owner/repo#commit`, and review their `package.json` yourself.

## Boundaries and limits

Document requests run in the plugin host through its existing HTTP proxy policy, without shell commands or `web_fetch`. Only Markdown entries from the fixed official documentation index can be fetched: redirects and arbitrary URLs are rejected, and TLS verification stays enabled. A request times out after 20 seconds, and one document is capped at 2 MiB.

A five-minute memory cache holds at most 32 pages / 8 MiB. Pass `refresh: true` to bypass it. Expired data must refresh successfully: failed requests are reported, never silently replaced by an old snapshot. Disabling the plugin cancels its requests and clears the cache. No bundled documentation snapshot, persistent index or separate MCP server is needed.

The website tracks the current published documentation, not necessarily the installed DSH version. Use `cordis_inspect_list` and `cordis_inspect_query` to verify runtime contracts, and consult the matching official `dsh-v*` source tag when versions differ. The tools do not fetch historical tags.

Official DSH does not read `dsh.plugin.json`. The other bundles in this repository ship that file for local discovery, so this package ships it too. The loader contract is `dsh.bundle.patch` in `package.json`.

## Install from npm

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

The published npm package includes the built `lib/` files.

## Install from GitHub

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

A Git install runs `prepare`, which builds `lib/`. pnpm blocks that script until the profile allowlists it, and the DSH 0.1.7-rc.2 CLI prints the exact key to add under `allowBuilds` in `$DSH_HOME/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

Run the add command again: that allowance executes this package's build on your machine. Pin a commit when the plugin source must not move.

Peer ranges on `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-agent-preset-registry` are checked against the running `dsh` version. This package requires DSH `>=0.1.7-rc.2`, and the loader does not enforce `engines.dsh`.

## Install from this checkout

```bash
pnpm install
pnpm --filter @klarkxy/dsh-dev-index build
dsh plugin --profile web add ./plugins/dsh-dev-index
```

Restart the profile, or let HMR apply the new bundle. Then:

```bash
dsh --profile web --dump-config
```

The composition should contain a `dsh-dev-index` row. Start a new Creator-mode session to pick up the documentation guidance automatically.

There is no configuration: the patch inserts the plugin and sets no keys.

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
