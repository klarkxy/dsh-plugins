# dsh-plugins

[Chinese documentation](README.zh-CN.md)

A small pnpm monorepo for focused DeepSeek Harness plugins that do not need a repository of their own. Each package under `plugins/` is an independently installable DSH bundle or native preset; see its installation instructions.

## Plugins and presets

| Package | Purpose |
| --- | --- |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.md) | Indexes DeepSeek Harness features and extension points for an agent doing DSH secondary development. |
| [`@klarkxy/dsh-pruner`](plugins/dsh-pruner/README.md) | Evidence-driven concept deletion and collapse through the native 删繁 / Pruner preset. |

Install individual plugins from npm:

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
dsh plugin --profile web add @klarkxy/dsh-pruner
```

The development index for agents is [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) (`llms.txt`, `index.json`, `meta.json`, and one markdown file per area). `docs/` in this repository is the only copy. `docs/meta.json` records `officialTag` and `officialCommit` for the DeepSeek Harness revision those pages describe. The `dsh-dev-index` plugin does not ship the pages. Its skill tells the agent to fetch the site, and to fall back to raw files on `main` at `https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/` when Pages does not respond. A daily refresh follows [docs/REFRESH.md](docs/REFRESH.md). GitHub Pages has to be enabled for this repository with the source set to GitHub Actions. The workflow is `.github/workflows/pages.yml`. Until that setting is on, the site URL will not serve. The raw `main` URLs still will, once this tree is on `main`.

## Development

Requires Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm check
```

Each package owns its assets, tests, and release version. Native presets need no runtime plugin or build. The repository root is not itself a DSH bundle.

## Automatic npm releases

Every `plugins/dsh-xxx` package is named `@klarkxy/dsh-xxx` and selects the public npm registry. `.github/workflows/npm-publish.yml` checks packages on every `main` update. It can also be retried manually from Actions; release tags are not required.

After building, CI fingerprints the files selected by `npm pack` and compares them with the published package. Only changed packages or explicitly higher versions are published. Repository docs, the index website and tests excluded from the archive do not cause npm releases. Version fields and CI's own `dshRelease.contentHash` are excluded from the fingerprint to avoid release loops.

First releases keep the source version; an explicitly higher version takes precedence. Changed contents with no version increase get an automatic patch bump, or a prerelease counter bump for prereleases. CI updates `package.json` and any `dsh.plugin.json`, runs checks, publishes and verifies the archive, then commits the version back to `main`. Stable releases use `latest`; prereleases use `next`. Choose minor/major versions explicitly for new features or breaking changes; automatic patching does not replace compatibility judgment.

Publishing runs are serialized. Superseded commits are skipped and version writeback uses a normal fast-forward push, preserving concurrent commits. Bot commits do not recursively trigger workflows. Success requires the registry archive integrity to match the local archive. Retry failures from the latest `main`; unchanged packages already published successfully are skipped.

Use the repository Actions secret `NPM_TOKEN` for first publication. Then configure a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) per package: owner `klarkxy`, repository `dsh-plugins`, workflow `npm-publish.yml`, no environment, and direct publishing allowed. The token can then be removed. Version writeback needs the workflow's `contents: write` permission and branch rules that allow the bot to push to `main`.

## License

[SATA License 2.1](LICENSE)
