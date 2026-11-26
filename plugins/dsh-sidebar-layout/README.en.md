# Sidebar Layout

<!-- release-state-note -->

[简体中文](README.md) / English

Switch the DeepSeek Harness right Sidebar between three presentations, and let the agent open workspace files or HTTP(S) URLs directly in the right preview panel via `open_sidebar`:

- **Push**: the native default — the open panel squeezes the conversation column.
- **Drawer**: the panel floats over the conversation, which keeps its full width; a dim mask covers the conversation while the panel is open, and clicking the mask closes the panel.
- **Body**: the panel moves into the centre column as the main body and the conversation moves to the right (IDE style); the host's right-edge drag handle then resizes the conversation column.
- **Autonomous sidebar preview (`open_sidebar`)**: after generating a report, HTML page, chart, document, or starting a local server, the agent can open the file (with optional `line` number and `sidebar` / `float` placement) or `http://` / `https://` URL immediately in the mounted session's right sidebar; off-screen sessions queue their preview until visited, without re-triggering on page reloads or history paging.

## Demo

![Switching from the tab's context menu: push → drawer (click the mask to close) → body (drag to resize)](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr38-sidebar-layout-tab-menu.gif)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-sidebar-layout
```

Replace `web` with your profile name and restart the profile when DSH asks. The plugin is enabled after installation and can be turned off in the plugin list.

## Use

The layout is a global setting; all three entry points drive the same state:

- **Tab menu**: right-click any right-panel tab to open its menu; a “Sidebar layout” group is appended at the end, with one row each for Push / Drawer / Body. The active mode is the current item. Choosing Drawer or Body while the panel is collapsed expands it.
- **Settings row**: the “Sidebar layout” row under Settings → General offers the same three options in a select.
- **Shortcut**: `Ctrl/Cmd + Alt + Shift + B` cycles Push → Drawer → Body → Push (the web build on Linux ships no default binding — assign one in the Shortcuts settings).
- **Tool row reopen**: expand any settled `open_sidebar` row in the conversation stream and click “Open in sidebar” to reopen the file or URL at any time.

The choice is stored in the current browser and restored on the next visit.

## Limitations

- The panel's fullscreen mode is untouched and keeps native host behaviour in all three layouts.
- The host still auto-collapses the panel when there is not enough room for a normal-width track — in drawer mode too.
- Files written only inside an isolated sandbox `/tmp` directory are not readable by the host preview service; save deliverables inside the workspace directory before calling `open_sidebar`.
- The plugin works alongside `dsh-better-sidebar`; neither affects the other.
- Disabling or uninstalling the plugin returns the sidebar to the native Push behaviour.

## License

[SATA License 2.1](LICENSE)
