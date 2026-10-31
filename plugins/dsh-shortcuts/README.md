# Shortcuts

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Customize DeepSeek Harness application and recognized local shortcuts, and run participating plugins' commands from a command palette.

## Install

For local evaluation before npm publication, build the complete package with its client bundle and install that artifact through the official DSH plugin manager. Once published, install the package through the same manager.

Enable the plugin in your GUI profile, then reload the page or restart the profile as the manager requires.

## Use

Open **Plugins → Shortcuts**:

- Browse current native command shortcuts and fixed local actions; the list updates as commands are added or removed.
- Change, unbind, or restore application shortcuts and recognized local actions: send, newline, complementary send, `/`, `@`, approval allow/reject, menu movement/selection/dismissal, and double-press stop.
- In **Additional shortcuts**, each binding has its own edit, unbind, and restore controls, showing original and effective keys together. Menu Up/Down and complementary Control/Meta bindings are edited separately.
- Stop keeps its double-press confirmation: choose one unmodified key, such as F8, and press it twice.
- Open the command palette to find and run commands registered by plugins. This plugin's commands also appear in the native shortcut list.
- When a local shortcut fails, a brief notification appears, and the plugin settings page shows the same failure while the notification is active.

In the **Web GUI**, the additional palette shortcut defaults to **Ctrl+Shift+P**, matching VS Code. Change this local opening shortcut in the plugin settings, including choosing **Ctrl+K**. It runs when the browser delivers the keypress to the page.

On **Desktop**, the palette also defaults to **Ctrl+Shift+P**, changeable in the plugin settings. **Ctrl+K** is assigned to session search (`session.search`) by default; to use it for the palette, review and explicitly confirm the binding change in the plugin settings to replace the session search binding.

DSH saves native shortcut changes: in the browser for Web, and on the current computer for Desktop. This plugin saves the extra Web palette shortcut and local-action overrides locally, separated by Web/Desktop and operating system.

## Limits

- The command palette runs commands explicitly registered with it by this or other participating plugins, while native commands remain listed in the shortcut table for reference and keybinding.
- Available commands depend on the current GUI and loaded plugins, and fixed actions appear while their owning interface is open. Collection covers shortcuts and actions registered with DSH.
- Application shortcuts follow native binding rules. Local overrides act in the recognized input, approval, menu, or conversation area, reject known global-key conflicts, and keep the host's reserved-key declarations intact.
- Local overrides adapt this host's existing controls. If a host upgrade changes an action's signature or a third-party fixed action lacks a recognized adapter, the editor reports incompatibility directly. Restoring the action's defaults or disabling the plugin restores native behavior.
- If the browser or OS captures Ctrl+K or another opening key before the page receives it, choose a different key in settings.
- Web and Desktop preferences are stored locally per environment and device.

## License

[SATA License 2.1](LICENSE)
