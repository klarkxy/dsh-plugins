# Font

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Customize the interface, conversation, code and terminal fonts and font sizes of the DeepSeek Harness Web GUI.

![A conversation shown in a custom conversation font](docs/preview.png)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-font
```

Replace `web` with your profile name, then restart the profile or reload the page.

## Use

Open **Settings → Font** — a dedicated section this plugin adds. While it is installed, the native **Font size** row in **Settings → General** is hidden so the same controls live in one place; uninstalling or disabling the plugin brings the native row back.

- **Interface font**: pick a preset, type any font name, or click **Load system fonts** to choose from fonts installed on this computer.
- **Conversation font** and **Font size**: the conversation's own font — **Same as interface font** keeps it following the interface font — and the size of conversation content.
- **Code font** and **Code font size**: applies to code blocks, inline code, and tool output.
- **Terminal font** and **Terminal font size**: applies to the sidebar terminal, independent of the code font.

Changes apply immediately and stay in sync with DSH settings — including the desktop Ctrl/⌘± font-size shortcut, which adjusts all three sizes. Choose **Default** to return to the DSH font; **Reset fonts** restores all font choices without touching sizes, and **Reset font sizes** restores all three sizes without touching fonts.

## Limits

- **Load system fonts** is supported in Chromium-based browsers and asks for permission.
- The interface, code and terminal fonts and all sizes are saved by DSH; the conversation font is saved in the current browser. Every computer where you open the GUI needs the chosen fonts installed.
- The plugin uses fonts already installed on your computer and bundles no font files of its own.

## License

[SATA License 2.1](LICENSE)
