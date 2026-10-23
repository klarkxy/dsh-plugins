# Font

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Change the interface font, code font, and conversation font size of the DeepSeek Harness Web GUI.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-font
```

Replace `web` with your profile name, then restart the profile or reload the page.

## Use

Open **Plugins → Font**:

- **Interface font** and **Code font**: pick a preset, type any font name, or click **Load system fonts** to choose from fonts installed on this computer.
- **Conversation font size**: 10–22 px, kept in sync with **Settings → General**.

Changes apply immediately and stay in sync with DSH settings. Choose **Default** to return to the DSH font; **Reset all to defaults** resets both font choices and the conversation size on this page.

Code font applies to code blocks and inline code. Terminal font and size are independent; adjust them in **Settings → General**.

## Limits

- **Load system fonts** works only in Chromium-based browsers and asks for permission.
- Font choices and conversation size are saved by DSH; every computer where you open the GUI needs the chosen fonts installed.
- No fonts are bundled; the chosen font must be installed on the computer.

## License

[SATA License 2.1](LICENSE)
