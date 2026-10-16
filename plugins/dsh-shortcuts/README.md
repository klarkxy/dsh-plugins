# Shortcuts

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Customize DeepSeek Harness application and recognized local shortcuts, and run participating plugins' commands from a command palette.

## Install

This package is not published to npm yet. For local evaluation, use a complete local build with its client bundle included and install that artifact through the official DSH plugin manager. A published package will be installable through the same manager once available.

Enable the plugin in your GUI profile, then reload the page or restart the profile as required by the manager.

## Use

Open **Plugins → Shortcuts**:

- Browse the current native command shortcuts and fixed local actions. The list updates as commands become available or are removed.
- Change, unbind, or restore application shortcuts and recognized local actions: send, newline, complementary send, `/`, `@`, approval allow/reject, menu movement/selection/dismissal, and double-press stop.
- In **Additional shortcuts**, each binding has its own edit, unbind, and restore controls. The original and effective keys appear together. Menu Up/Down and complementary Control/Meta bindings are edited separately.
- Stop preserves the double-press confirmation. Choose one unmodified key, such as F8, and press it twice; modifier combinations and two-key chords cannot preserve the host's stop sequence.
- Open the command palette to find and run commands from plugins that have registered with it. This plugin's registered commands also appear in the native shortcut list.

In the **Web GUI**, the additional palette shortcut defaults to **Ctrl+Shift+P**, matching VS Code. You can change this local opening shortcut in the plugin settings, including manually choosing **Ctrl+K**. It works when the browser delivers the keypress to the page.

On **Desktop**, the palette also defaults to **Ctrl+Shift+P**. You can change its shortcut in the plugin settings. **Ctrl+K** is already assigned to session search (`session.search`); to use it for the palette, review and explicitly confirm the binding change in the plugin settings. This replaces the session search binding for Ctrl+K.

Native shortcut changes are saved by DSH: locally in the browser for Web, and on the current computer for Desktop. The additional Web palette shortcut and local-action overrides are saved locally by this plugin. Local overrides are separated by Web/Desktop and operating system.

## Limits

- The command palette can execute only commands registered with it by this plugin or other participating plugins. Native commands remain visible in the shortcut list, but appearing there does not make them executable from the palette.
- Available commands depend on the current GUI and loaded plugins. Fixed actions may appear only while their owning interface is open. Third-party keyboard listeners that do not register with DSH, terminal/editor internals, and browser or OS shortcuts cannot be automatically collected.
- Application shortcuts follow native binding rules. Local overrides act only in the recognized input, approval, menu, or conversation area and reject known global-key conflicts. They do not remove the host's original reserved-key declarations.
- Local overrides adapt this host's existing controls. If a host upgrade changes an action's signature or a third-party fixed action has no recognized adapter, the editor reports incompatibility rather than pretending a new key works. Restoring the action's defaults or disabling the plugin restores native behavior.
- Browsers or the operating system may capture Ctrl+K or another opening key before the page receives it. Choose another key in settings if needed.
- Web and Desktop preferences are local to their environment; this plugin does not synchronize them across browsers or computers.

## License

[SATA License 2.1](LICENSE)
