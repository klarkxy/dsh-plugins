# Workspace Folders

<!-- release-state-note -->

[简体中文](README.md) / English

Add multiple additional folders to each DeepSeek Harness workspace and access them together in its Agent conversations.

## Install

This plugin is currently under local development and has not been published to npm yet. From the repository root, build and install the local package:

```sh
pnpm --filter @klarkxy/dsh-workspace-folders build
dsh plugin --profile web add ./plugins/dsh-workspace-folders
```

Replace `web` with your profile name, restart the target profile, and ensure the plugin is enabled. Runtime requirements are listed in [package.json](package.json).

## Usage

1. Open the workspace **⋯** menu in the sidebar and select **Folders…**.
2. The dialog displays the fixed primary folder (tagged **Primary**) alongside any additional folders saved for that workspace.
3. Click **Add folder**: browse directories on the machine running DSH (or click **Browse…** when a native picker is available), or enter an absolute directory path and click **Open**, then click **Add this folder**.
4. Remove entries with the row remove button (files on disk are untouched), then click **Save** to apply or **Cancel** to discard edits.

Changes take effect on the next conversation turn and are shared across conversations in that workspace (including delegated child sessions). Additional folders are exposed to the Agent as workspace context and added as writable roots under workspace-write mode. The primary working directory stays unchanged, so commands and relative paths still resolve from there; refer to an additional folder by name or absolute path when needed.

## Limitations

- The Web UI browses and validates folders on the machine running the DSH host (including over remote connections); each folder must exist and be accessible there.
- Read-only sessions remain read-only, and other host approval and sandbox rules continue to apply.
- Additional folders provide working context and file access only; project configuration, skills, hooks, and automatic instruction discovery continue to follow the primary project.
- Active turns keep the folder permissions captured when they started; folder edits apply to subsequent turns (up to 64 additional folders per workspace).

## License

[SATA License 2.1](LICENSE)
