# DSH Docs

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Read the official DeepSeek Harness documentation without leaving DSH, and give Creator mode tools to look up the docs and check plugins before installing them.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-dev-index
```

Replace `web` with your profile name and restart the profile.

## Use

- **Plugins → DSH Docs** shows the [official documentation site](https://deepseek-harness.github.io/deepseek-harness/) inside DSH, with a Chinese / English switch.
- In Creator mode the agent gets five read-only tools: `dsh_docs_search` and `dsh_docs_fetch` to find and read official docs, `dsh_plugins_search` and `dsh_plugins_fetch` to check a plugin's npm information before installing it (search sources: catalog, npm or GitHub repositories), and `dsh_github_fetch` to inspect a GitHub plugin repository and pin its branch to an exact commit. Creator mode is also reminded to verify runtime interfaces with `cordis_inspect_list` and `cordis_inspect_query`.

## Limits

- The tools only read; they never install anything. Installing stays with the DSH plugin manager.
- The website follows the latest DSH release, which may differ from the version you run.
- npm metadata is not proof that a plugin works with your DSH.
- GitHub data comes from your local signed-in gh CLI or anonymous API access (a small hourly quota); the plugin stores no GitHub credentials. Manifest-based code search is only available when gh is signed in.
- Cancelling the last request using a GitHub CLI check waits for that check to stop. Unloading the plugin waits for its active GitHub requests and CLI processes to finish.

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
