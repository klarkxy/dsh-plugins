# Subagent model discovery repair

[中文](README.zh-CN.md)

A local desktop repair for incomplete subagent model discovery. It lists every route allowed by the current conversation, keeps provider and model IDs separate, and reports missing providers, missing credentials, and model metadata failures. It does not change the allowed list or test paid model calls.

## Install

Use the reviewed archive and its receipt prepared for your installation. Completely quit DeepSeek Harness, including the tray process, then run in a separate PowerShell terminal:

```powershell
& 'H:\Code\dsh-plugins\host-patches\subagent-model-discovery\install.ps1' -Receipt 'H:\Code\dsh-plugins\.scratch\subagent-model-discovery-reviewed\receipt.json' -Action apply
```

The installer verifies the original and prepared archives, preserves the original as a backup, and replaces it atomically. It refuses to install while DeepSeek Harness is running or if the installed archive has changed. Start DeepSeek Harness again after installation.

## Use

Ask the agent to call `list_subagent_models` with no arguments. Each row contains separate `provider` and `model` values, model metadata, reasoning efforts, and any discovery failure. Only use those separate IDs when selecting a child model.

Allowed routes are saved per conversation. Editing the model list applies to new top-level conversations; existing conversations and their subagents retain their saved lists. The model-hub plugin also explains this on its settings page.

To restore the original archive, completely quit DeepSeek Harness and run the same command with `-Action restore`. Use `-Action check` to inspect the installation without changing it.

## Limits

- This repair accepts only the inspected host code. A different release must be reviewed before patching.
- Provider metadata is not proof of credentials, network access, or a successful model call. Actual calls still pass through the host's original authorization and validation.
- Missing credentials also become a visible failure in the browser's model catalog, rather than silently hiding that provider.
- A desktop update replaces this local repair. The original backup remains available, but must not be restored over a different release.
- The application must be restarted to load repaired host code. This is a local patch, not an official DeepSeek release.

The original host code is Copyright (c) 2026 DeepSeek and distributed under the accompanying MIT license.
