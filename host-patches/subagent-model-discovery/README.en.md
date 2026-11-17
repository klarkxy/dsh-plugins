# Subagent model discovery repair

[简体中文](README.md) / English

A local desktop repair for incomplete subagent model discovery. It lists every route allowed by the current conversation, keeps `provider` and `model` IDs separate, and reports missing providers, missing credentials, and model metadata failures, while keeping the allowed list unchanged and making zero paid model calls.

## Install

Use the reviewed archive and receipt prepared for your installation. Completely quit DeepSeek Harness, including the tray process, then run in a separate PowerShell terminal:

```powershell
& '<repo-root>\host-patches\subagent-model-discovery\install.ps1' -Receipt '<repo-root>\.scratch\subagent-model-discovery-reviewed\receipt.json' -Action apply
```

The installer verifies both the original and prepared archives, preserves the original as a backup, and replaces it atomically while DeepSeek Harness is closed and the installed archive matches the expected baseline. Start DeepSeek Harness again after installation.

## Use

Ask the agent to call `list_subagent_models` with no arguments. Each row provides separate `provider` and `model` values, model metadata, reasoning efforts, and any discovery failure; pass those separate IDs when selecting a subagent model.

Allowed routes are saved per conversation. Editing the allowed list applies to new top-level conversations, while existing conversations and their subagents retain their saved lists. The Model Management plugin also notes this on its settings page.

To restore the original archive, completely quit DeepSeek Harness and run the same command with `-Action restore`. Use `-Action check` to inspect installation state read-only.

## Limitations

- This repair applies only to the inspected host release; review a new release before patching.
- Provider metadata describes catalog entries; actual calls still go through the host's authorization, credential, and network checks.
- Missing credentials appear as explicit failures in the browser's model catalog so every configured provider remains visible.
- A desktop update replaces this local repair; keep the original backup matched to the release it came from.
- Restart the application to load the repaired host code. This is a local patch for an installed desktop build.

Original host code is Copyright (c) 2026 DeepSeek under the accompanying [MIT license](UPSTREAM-LICENSE).
