# dsh-dev-index

[Chinese documentation](README.zh-CN.md)

A DeepSeek Harness bundle that points an agent at one index of DSH features and extension points while it writes plugins, presets, patches, profiles, providers, or other DSH secondary development.

The index itself is not in this package. `docs/` in [klarkxy/dsh-plugins](https://github.com/klarkxy/dsh-plugins) is the only copy, and it is published at [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/). `docs/meta.json` records `officialTag` and `officialCommit` for the [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) revision those pages describe. Every area names the official file it came from. The index does not invent APIs.

## Why a skill

DSH's agent-facing knowledge contract is a skill on `ctx.skills`. `@deepseek-ai/dsh-skill` documents `ctx.skills.register` for an embedded instruction set, and `@deepseek-ai/dsh-tool-skill` puts model-invocable skills in the session catalog and loads them with the `skill` tool. A preset would replace the agent's composition. A tool would have to be called before the agent knew the index existed. A host-level skill is listed beside the agent's other skills and stays available in every base-backed profile.

On `apply`, this plugin registers the skill `dsh-dev-index`. The body only tells the agent where to fetch the current index:

- `https://klarkxy.github.io/dsh-plugins/llms.txt`
- `https://klarkxy.github.io/dsh-plugins/index.json`
- `https://klarkxy.github.io/dsh-plugins/meta.json`
- `https://klarkxy.github.io/dsh-plugins/areas/<id>.md`

If Pages does not respond, the same paths are on GitHub `main`:

`https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/`

The body also lists area ids so the agent knows which `areas/<id>.md` files exist. It does not copy page text or the indexed commit, so a daily docs refresh does not require a new package release.

`sdk-minimal` does not mount `@deepseek-ai/dsh-skill`. There the plugin stays pending because it injects `skills`. Web, headless, sdk, and acp build on `@deepseek-ai/dsh-base`, which mounts the registry.

Official DSH does not read `dsh.plugin.json`. This repository's other bundles ship that file for local discovery, so this package does too. The loader contract is `package.json` `dsh.bundle.patch`.

## Install from GitHub

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

A Git install runs `prepare`, which builds `lib/`. pnpm blocks that script until the profile allowlists it. The DSH 0.1.7-rc.2 CLI tells you to add the exact key it prints under `allowBuilds` in `$DSH_HOME/profiles/web/pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-dev-index: true
```

Run the add again. That allowance executes this package's build on the machine. Pin a commit when the plugin source must not move. The index the skill fetches still follows `main` and the Pages site.

Peer ranges on `@deepseek-ai/dsh-skill` are checked against the running `dsh` version. This package requires DSH `>=0.1.7-rc.2 <0.2.0` because it calls `ctx.skills.register` from that release. `engines.dsh` is not enforced by the loader; the peer range is. The indexed docs revision is `docs/meta.json`, not this peer range.

## Install from this checkout

```bash
pnpm install
pnpm --filter dsh-dev-index build
dsh plugin --profile web add ./plugins/dsh-dev-index
```

Restart the profile, or let HMR apply the new bundle. Then:

```bash
dsh --profile web --dump-config
```

The composition should contain a `dsh-dev-index` row. In a new session, load the `dsh-dev-index` skill before changing DSH plugins or presets.

## Configuration

The patch sets the only key. A later layer that overrides the row must restate it, because a patch replaces `config` wholesale.

| Key | Default | Meaning |
| --- | --- | --- |
| `pagesBaseUrl` | `https://klarkxy.github.io/dsh-plugins/` | Absolute http(s) base URL written into the skill body. A missing trailing slash is added. The raw GitHub fallback stays on this repository's `main`. |

## Refresh

The daily procedure is [docs/REFRESH.md](../../docs/REFRESH.md). Regenerate the rendered site from `docs/` with:

```bash
node plugins/dsh-dev-index/scripts/build-site.mjs
```

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove dsh-dev-index
```
