# Workspace Folders

Add multiple folders to each DeepSeek Harness workspace and use them together in Agent conversations.

[简体中文](docs/README.zh-CN.md)

<!-- release-state-note -->

## What it does

- Adds a **Folders…** action to the workspace menu.
- Keeps the primary folder and manages additional folders in a single dialog.
- Saves a separate folder list for each workspace, shared by its conversations.
- Makes the folder list available to the Agent and includes those directories in workspace-write access, while retaining the session's permission mode.

## Install

This plugin is under local development. From the repository root, build and install the local package:

```sh
pnpm --filter @klarkxy/dsh-workspace-folders build
dsh plugin --profile web add ./plugins/dsh-workspace-folders
```

Restart the target profile and enable the plugin. Runtime requirements are listed in [package.json](package.json).

## Use

1. Open the workspace's **⋯** menu and choose **Folders…**.
2. Choose a folder on the machine running DSH, or enter its absolute path.
3. Add or remove additional folders, then select **Save**. **Cancel** discards the draft.

Changes apply on the next conversation turn. The primary working directory stays the same; commands and relative file paths continue to resolve there. Ask the Agent to use an additional folder by name or absolute path when needed.

Removing a folder from the list keeps its files on disk. Reopening the dialog shows the saved list.

## Limitations

- The Web interface manages folders on the DSH host, including when you connect from another machine. Each selected folder must exist and be accessible there.
- Read-only sessions remain read-only. Other host approval and sandbox rules still apply.
- Additional folders provide working context and file access. Project configuration and automatic instruction discovery continue to follow the primary project.
- Existing processes retain the permissions they started with; a folder-list edit applies to subsequent turns.
