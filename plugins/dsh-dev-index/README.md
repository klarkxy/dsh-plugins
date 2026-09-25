# dsh-dev-index

[Chinese documentation](README.zh-CN.md)

A DeepSeek Harness bundle that gives an agent one index of DSH features and extension points while it writes plugins, presets, patches, profiles, providers, or other DSH secondary development.

The index is curated from the official repository [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) at tag `dsh-v0.1.7-rc.2`, commit `477b4f420553e8a52c2fbccc464d7561b239c443`. Every area names the official file it came from. It does not invent APIs.

## Why a skill

DSH's agent-facing knowledge contract is a skill on `ctx.skills`. `@deepseek-ai/dsh-skill` documents `ctx.skills.register` for an embedded instruction set, and `@deepseek-ai/dsh-tool-skill` puts model-invocable skills in the session catalog and loads them with the `skill` tool. A preset would replace the agent's composition. A tool would have to be called before the agent knew the index existed. A host-level skill is listed beside the agent's other skills and stays available in every base-backed profile.

On `apply`, this plugin registers the skill `dsh-dev-index`. The body is a short router, kept under the standard preset's tool-result trim, and names each area file. `resourceBase` is the installed `content/` directory, so the agent can read `index.json` and `areas/<id>.md` offline. The same files are published at [https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/).

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

Run the add again. That allowance executes this package's build on the machine. Pin a commit when the source must not move.

Peer ranges on `@deepseek-ai/dsh-skill` are checked against the running `dsh` version. This package requires DSH `>=0.1.7-rc.2 <0.2.0`, the version the index describes. `engines.dsh` is not enforced by the loader; the peer range is.

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
| `pagesBaseUrl` | `https://klarkxy.github.io/dsh-plugins/` | Absolute http(s) base URL written into the skill body. A missing trailing slash is added. |

## Refresh

See [REFRESH.md](REFRESH.md). Regenerate the site with:

```bash
node plugins/dsh-dev-index/scripts/build-site.mjs
```

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove dsh-dev-index
```
