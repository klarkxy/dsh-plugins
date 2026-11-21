# Sidebar Layout

<!-- release-state-note -->

[简体中文](README.md) / English

Switch the DeepSeek Harness right Sidebar between three presentations:

- **Push**: the native default — the open panel squeezes the conversation column.
- **Drawer**: the panel floats over the conversation, which keeps its full width; a dim mask covers the conversation while the panel is open, and clicking the mask closes the panel.
- **Body**: the panel moves into the centre column as the main body and the conversation moves to the right (IDE style); the host's right-edge drag handle then resizes the conversation column.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-sidebar-layout
```

Replace `web` with your profile name and restart the profile when DSH asks. The plugin is enabled after installation and can be turned off in the plugin list.

## Use

The layout is a global setting; all three entry points drive the same state:

- **Session header button**: the “Sidebar layout” icon in the session header's utility strip opens a menu with Push / Drawer / Body; the active mode is checked. Choosing Drawer or Body while the panel is collapsed expands it.
- **Settings row**: the “Sidebar layout” row under Settings → General offers the same three options in a select.
- **Shortcut**: `Ctrl/Cmd + Alt + Shift + B` cycles Push → Drawer → Body → Push (the web build on Linux ships no default binding — assign one in the Shortcuts settings).

The choice is stored in the current browser and restored on the next visit.

## Limitations

- The panel's fullscreen mode is untouched and keeps native host behaviour in all three layouts.
- The host still auto-collapses the panel when there is not enough room for a normal-width track — in drawer mode too.
- The plugin works alongside `dsh-better-sidebar`; neither affects the other.
- Disabling or uninstalling the plugin returns the sidebar to the native Push behaviour.
