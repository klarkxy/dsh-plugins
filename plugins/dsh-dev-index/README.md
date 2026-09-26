# dsh-dev-index

[Chinese documentation](README.zh-CN.md)

A lightweight DeepSeek Harness skill. It points an agent at official DSH material and does not ship or maintain a copy of the docs.

Inside a running DSH, prefer the official `cordis-plugin-development` skill and the read-only inspect tools `cordis_inspect_list` and `cordis_inspect_query`. Every `plugin_manager` action needs `danger-full-access` or a one-off approval. The environment's own tool policy still applies.

Readable docs are the official site [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/) (Chinese at the site root, English under `/en/`) and [llms.txt](https://deepseek-harness.github.io/deepseek-harness/llms.txt). That site is the latest published release. Source and type declarations default to [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) `master`. When the target version differs, use the matching `dsh-v*` tag and do not mix versions.

[https://klarkxy.github.io/dsh-plugins/](https://klarkxy.github.io/dsh-plugins/) only redirects there. Old paths on that host redirect as well.

## Why a skill

DSH's agent-facing knowledge contract is a skill on `ctx.skills`. `@deepseek-ai/dsh-skill` documents `ctx.skills.register` for an embedded instruction set, and `@deepseek-ai/dsh-tool-skill` puts model-invocable skills in the session catalog and loads them with the `skill` tool. A preset would replace the agent's composition. A tool would have to be called before the agent knew the pointer existed. A host-level skill is listed beside the agent's other skills and stays available in every base-backed profile.

On `apply`, this plugin registers the skill `dsh-dev-index`. The body is static. It does not embed a commit, a tag, or a URL on this repository.

`sdk-minimal` does not mount `@deepseek-ai/dsh-skill`. There the plugin stays pending because it injects `skills`. Web, headless, sdk, and acp build on `@deepseek-ai/dsh-base`, which mounts the registry.

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

Peer ranges on `@deepseek-ai/dsh-skill` are checked against the running `dsh` version. This package requires DSH `>=0.1.7-rc.2 <0.2.0` because it calls `ctx.skills.register` from that release. `engines.dsh` is not enforced by the loader; the peer range is.

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

The composition should contain a `dsh-dev-index` row. In a new session, load the `dsh-dev-index` skill before changing DSH plugins or presets.

There is no configuration. The patch inserts the plugin and does not set keys.

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove @klarkxy/dsh-dev-index
```
