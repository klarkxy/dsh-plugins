# Shortcuts

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Customize DeepSeek Harness application and recognized local shortcuts, and run participating plugins' commands from a command palette.

## Install

Not published to npm yet. For local evaluation, use a complete local build including its client bundle and install that artifact through the official DSH plugin manager. Once published, the package installs through the same manager.

Enable the plugin in your GUI profile, then reload the page or restart the profile as the manager requires.

## Use

Open **Plugins → Shortcuts**:

- Browse current native command shortcuts and fixed local actions; the list updates as commands are added or removed.
- Change, unbind, or restore application shortcuts and recognized local actions: send, newline, complementary send, `/`, `@`, approval allow/reject, menu movement/selection/dismissal, and double-press stop.
- In **Additional shortcuts**, each binding has its own edit, unbind, and restore controls, showing original and effective keys together. Menu Up/Down and complementary Control/Meta bindings are edited separately.
- Stop keeps its double-press confirmation. Choose one unmodified key, such as F8, and press it twice; modifier combinations and two-key chords cannot preserve the host's stop sequence.
- Open the command palette to find and run commands registered by plugins. This plugin's commands also appear in the native shortcut list.

In the **Web GUI**, the additional palette shortcut defaults to **Ctrl+Shift+P**, matching VS Code. Change this local opening shortcut in the plugin settings, including choosing **Ctrl+K**. It works when the browser delivers the keypress to the page.

On **Desktop**, the palette also defaults to **Ctrl+Shift+P**, changeable in the plugin settings. **Ctrl+K** is already assigned to session search (`session.search`); to use it for the palette, review and explicitly confirm the binding change in the plugin settings. This replaces the session search binding for Ctrl+K.

DSH saves native shortcut changes: in the browser for Web, on the current computer for Desktop. This plugin saves the extra Web palette shortcut and local-action overrides locally; overrides are separate per Web/Desktop and operating system.

## Limits

- The command palette runs only commands registered with it by this or other participating plugins. Native commands stay visible in the shortcut list, but appearing there does not make them runnable from the palette.
- Available commands depend on the current GUI and loaded plugins; fixed actions may appear only while their owning interface is open. Third-party keyboard listeners not registered with DSH, terminal/editor internals, and browser or OS shortcuts cannot be collected automatically.
- Application shortcuts follow native binding rules. Local overrides act only in the recognized input, approval, menu, or conversation area and reject known global-key conflicts; they do not remove the host's reserved-key declarations.
- Local overrides adapt this host's existing controls. If a host upgrade changes an action's signature or a third-party fixed action has no recognized adapter, the editor reports incompatibility rather than claiming a new key works. Restoring the action's defaults or disabling the plugin restores native behavior.
- Browsers or the OS may capture Ctrl+K or another opening key before the page receives it; choose another key in settings.
- Web and Desktop preferences are local to their environment; this plugin does not sync them across browsers or computers.

## License

[SATA License 2.1](LICENSE)
