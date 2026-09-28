# DSH Docs

[Chinese documentation](README.zh-CN.md)

The plugin page embeds the official DSH documentation for readers. Creator mode receives a short instruction to consult official material before developing DSH plugins.

Inside a running DSH, the instruction points Creator mode to the read-only inspect tools `cordis_inspect_list` and `cordis_inspect_query`. The environment's own tool and approval policies still apply.

Readers use the [official documentation site](https://deepseek-harness.github.io/deepseek-harness/) (Chinese at the site root, English under `/en/`). Agents start from its [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt) index and fetch relevant raw Markdown pages. The site reflects the latest published release. For version-specific docs, source, and type declarations, use [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `master` only when it matches the target version; otherwise use the matching `dsh-v*` tag. Do not mix versions.

The plugin no longer ships or depends on a mirrored index. The [klarkxy Pages site](https://klarkxy.github.io/dsh-plugins/) is now a catalog of klarkxy's DSH plugins; its old index URLs redirect to the official site.

## Read in the Plugins page

In DSH Web, open **Plugins → DSH development index**. The page displays the official GitHub Pages documentation in a browser panel. It follows the DSH interface language, offers Chinese and English, and links to the site in a separate tab. If the embedded page cannot load, choose **Open in browser**.

## Creator mode guidance

The Host plugin adds one system-prompt section when the session uses the `cordis` preset (Creator mode). It directs the agent to `dsh_docs_search`, then `dsh_docs_fetch`, before choosing APIs. Other presets receive no extra prompt. Both read-only tools are registered with the host tool registry and remain subject to its tool policies. The plugin does not register a skill.

- `dsh_docs_search({ query: "plugin", language: "en" })` searches the live official `llms.txt` directory: titles, categories and paths. This is not full-text search. An empty result does not establish that a topic is absent from the document bodies; try broader Chinese or English keywords.
- `dsh_docs_fetch({ id: "en/develop/basic/tool.md" })` reads a document ID returned by search. Results include the source URL, fetch time, content revision and `nextOffset`. Continue with that offset and the same `revision`; if the document changes, restart from offset zero. The default page size is 12,000 characters, at most 16,000.

Requests run in the plugin host through its existing HTTP proxy policy, without shell commands or `web_fetch`. Only Markdown entries from the fixed official documentation index can be fetched. Redirects and arbitrary URLs are rejected; TLS verification remains enabled. Requests time out after 20 seconds and documents are capped at 2 MiB.

A five-minute memory cache holds at most 32 pages / 8 MiB. Pass `refresh: true` to bypass it. Expired data must refresh successfully: failed requests are reported, never silently replaced by an old snapshot. Disabling the plugin cancels its requests and clears the cache. No bundled documentation snapshot, persistent index or separate MCP server is needed.

The website tracks current published documentation, not necessarily the installed DSH version. Use `cordis_inspect_list` and `cordis_inspect_query` to verify runtime contracts; consult the matching official `dsh-v*` source tag when versions differ. The tools do not fetch historical tags.

Official DSH does not read `dsh.plugin.json`. This repository's other bundles ship that file for local discovery, so this package does too. The loader contract is `package.json` `dsh.bundle.patch`.

## Install from npm

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

The npm package includes the built `lib/` files.

## Install from GitHub

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

A Git install runs `prepare`, which builds `lib/`. pnpm blocks that script until the profile allowlists it. The DSH 0.1.7-rc.2 CLI tells you to add the exact key it prints under `allowBuilds` in `$DSH_HOME/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

Run the add again. That allowance executes this package's build on the machine. Pin a commit when the plugin source must not move.

Peer ranges on `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-agent-preset-registry` are checked against the running `dsh` version. This package requires DSH `>=0.1.7-rc.2`; `engines.dsh` is not enforced by the loader.

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

The composition should contain a `dsh-dev-index` row. Start a new Creator-mode session to receive the documentation guidance automatically.

There is no configuration. The patch inserts the plugin and does not set keys.

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
