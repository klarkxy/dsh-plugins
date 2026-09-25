# dsh-plugins

[Chinese documentation](README.zh-CN.md)

A small pnpm monorepo for focused DeepSeek Harness plugins that do not need a repository of their own. Each package under `plugins/` is an independently installable DSH bundle or native preset; see its installation instructions.

## Plugins and presets

| Package | Purpose |
| --- | --- |
| [`dsh-current-title`](plugins/dsh-current-title/README.md) | Keeps a session title aligned with the current task using `MMDD | localized type | summary`. |
| [`dsh-dev-index`](plugins/dsh-dev-index/README.md) | Indexes DeepSeek Harness features and extension points for an agent doing DSH secondary development. |
| [`dsh-pruner`](plugins/dsh-pruner/README.md) | Evidence-driven concept deletion and collapse through the native 删繁 / Pruner preset. |

Install the current-title plugin directly from its GitHub subdirectory:

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-current-title"
```

Git source installs require a one-time pnpm build allowlist. See the plugin documentation for the exact profile setting and platform notes.

The development index for agents is [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) (`llms.txt`, `index.json`, `meta.json`, and one markdown file per area). `docs/` in this repository is the only copy. `docs/meta.json` records `officialTag` and `officialCommit` for the DeepSeek Harness revision those pages describe. The `dsh-dev-index` plugin does not ship the pages. Its skill tells the agent to fetch the site, and to fall back to raw files on `main` at `https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/` when Pages does not respond. A daily refresh follows [docs/REFRESH.md](docs/REFRESH.md). GitHub Pages has to be enabled for this repository with the source set to GitHub Actions. The workflow is `.github/workflows/pages.yml`. Until that setting is on, the site URL will not serve. The raw `main` URLs still will, once this tree is on `main`.

## Development

Requires Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm check
```

Each package owns its assets, tests, and release version. Native presets need no runtime plugin or build. The repository root is not itself a DSH bundle.

## License

[SATA License 2.1](LICENSE)
