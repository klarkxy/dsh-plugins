# Shortcuts

<!-- release-state-note -->

[简体中文](README.md) / English

Customize DeepSeek Harness application shortcuts and recognized local actions, and run participating plugins' commands from a command palette.

## Install

This plugin is currently in local development and has not yet been published to npm. Build the complete package with its client bundle from the repository root, then install from the local path:

```sh
pnpm --filter @klarkxy/dsh-shortcuts build
dsh plugin --profile web add ./plugins/dsh-shortcuts
```

Once published, install directly using the package name:

```sh
dsh plugin --profile web add @klarkxy/dsh-shortcuts
```

Replace `web` with your profile name, enable the plugin in your GUI profile, and reload the page or restart the profile as the manager requires.

## Usage

Open **Settings → Shortcuts** to browse, search, and rebind shortcuts:

### Command Palette Shortcut

- **Web**: Defaults to `Ctrl+Shift+P` (matching VS Code). Change, unbind, or restore `Ctrl+Shift+P` in settings (including choosing `Ctrl+K`, using Control, Alt, or Meta plus a letter or digit). It triggers when the browser delivers the keypress to the page with no conflicts and no modal dialog open.
- **Desktop**: Also defaults to `Ctrl+Shift+P` (rebindable in the application shortcuts list below). Because `Ctrl+K` is assigned to session search (`session.search`) by default, click **Use Ctrl+K** in settings and explicitly confirm in the dialog to unbind session search and assign `Ctrl+K` to the palette (session search remains accessible in the UI or can be bound to another key in the list).

### Application Shortcuts & Local Overrides

- **Application shortcuts**: Browse and search live native command shortcuts, with per-command edit, clear, reset, and **Reset all shortcuts**. Desktop also supports recording two keys held together. Native shortcut changes are stored by DSH (in the browser on Web, and on the current device on Desktop).
- **Additional shortcuts (local overrides)**: View and customize recognized local actions across the composer (send, newline, complementary send, `/`, `@`), menus (move up/down, select, dismiss), approval prompts (allow, reject), and stopping a response.
  - Each binding slot has independent edit, unbind, and restore actions while showing both the **Original key** and **Effective key**. Menu Up/Down and complementary Control/Meta bindings are edited separately.
  - **Double-press stop key**: Stopping a response keeps its double-press confirmation; choose one key without modifiers (such as `F8`), press it once when recording, and press the effective key twice in succession to stop a response.
  - When a local shortcut fails to dispatch, a brief notification appears and the settings page displays the same failure while active.
  - Extra Web palette triggers and local-action overrides are stored locally by this plugin, separated by Web/Desktop and operating system.

### Command Palette

- Open the command palette via its shortcut or **Open shortcut palette** in settings to search and run commands registered by participating plugins. A **View and edit all shortcuts** button in the palette footer opens the shortcut manager dialog and returns cleanly. This plugin's own **Open command palette** command also appears in the application shortcuts list.

## Limitations

- The command palette executes commands registered with it by participating plugins; native host commands remain listed in application shortcuts for reference and rebinding.
- Available commands depend on the active interface and loaded plugins, and fixed local actions appear while their owning interface is open. Collection covers shortcuts and actions registered with DSH.
- Application shortcuts follow host binding rules. Local overrides act within recognized input, menu, approval, or conversation regions, reject known global-key conflicts, and respect the host's reserved-key declarations.
- Local overrides adapt existing host controls. If a host update changes an action's signature or a third-party fixed action lacks a recognized adapter, settings marks it **Editing unavailable** while native behavior stays intact. Restoring defaults or disabling the plugin restores native behavior.
- If the browser or operating system intercepts `Ctrl+K` or another shortcut before the page receives it, choose another combination in settings.
- Web and Desktop preferences and overrides are stored locally per environment and device and do not sync across devices.

## License

[SATA License 2.1](LICENSE)
