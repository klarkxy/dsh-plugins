# DSH Docs

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Read the official DeepSeek Harness docs inside DSH, and give the agent tools to look up docs and check plugins before installing them.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

Replace `web` with your profile name and restart the profile.

## Use

- **Plugins → DSH Docs** shows the [official documentation site](https://deepseek-harness.github.io/deepseek-harness/) inside DSH, with a Chinese / English switch.
- The agent gets two read-only tools: `dsh_docs` to search and read official docs, and `dsh_plugins` to check a plugin's npm information before installing it (search sources: catalog, npm or GitHub repositories) or inspect a GitHub plugin repository and pin its branch to an exact commit. In Creator mode the agent is also reminded to use these tools and verify runtime interfaces with `cordis_inspect_list` and `cordis_inspect_query`.

## Limits

- The tools are strictly read-only; installing plugins stays with the DSH plugin manager.
- The website tracks the latest DSH release, which may differ from the version you run.
- npm metadata describes the published package; verify host compatibility before relying on a plugin.
- GitHub data comes from your local signed-in gh CLI or anonymous API access (a small hourly quota), with zero GitHub credentials stored by the plugin. Manifest-based code search requires a signed-in gh CLI.
- Cancelling the last request using a GitHub CLI check waits for that check to stop; unloading the plugin waits for its active GitHub requests and CLI processes to finish.

## Install from GitHub

```sh
dsh plugin --profile web add "github:klarkxy/dsh-plugins#path:/plugins/dsh-dev-index"
```

A GitHub install builds the plugin locally, so pnpm first asks you to allow it. Add this to `$DSH_HOME/profiles/web/pnpm-workspace.yaml`, then run the command again:

```yaml
allowBuilds:
  '@klarkxy/dsh-dev-index': true
```

## License

[SATA License 2.1](LICENSE)
