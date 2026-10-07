# @klarkxy/dsh-font

Font: customize the **interface font**, **code font**, and **conversation font size** of the DeepSeek Harness Web GUI from one settings panel.

[中文文档](docs/README.zh-CN.md)

## What it does

The plugin adds a settings panel to its bundle page in the Plugins view:

- **Interface font** — the typeface of all interface text. Pick a preset (Microsoft YaHei, PingFang SC, SimSun, KaiTi, Source Han Sans/Serif), pick an actually-installed family via **Load system fonts**, or enter any CSS `font-family` stack. Empty restores the host default.
- **Code font** — the monospace typeface of code blocks, inline code and terminals. Presets include Cascadia, JetBrains Mono, Fira Code, Consolas, Sarasa Mono and Maple Mono; system fonts and custom stacks are accepted too.
- **Conversation font size** — 10–22 px, driven through the official `ctx.theme.setFontSize()` entry. It stays in sync with the native stepper in Settings → General and persists through the host settings scope.

*Load system fonts* uses the Local Font Access API (`window.queryLocalFonts()`): Chromium-only and gated behind a browser permission prompt. Every click re-enumerates — after the first read the button relabels to *Reload system fonts*, so fonts installed later appear on the next click. Each entry commits the exact family name CSS needs, while the label leads with the name the UI locale recognizes — a converted font shows as `华康少女文字W5(P)（DFPShaoNvW5-GB）` in Chinese and `DFPShaoNvW5-GB（华康少女文字W5(P)）` in English. Where the API is unavailable or denied (Firefox, Safari, Electron policy), the panel simply keeps the preset + manual-input flow. No font files are bundled — every choice is rendered with fonts already installed on the machine, falling back through the stack when a family is missing.

Changes apply immediately: the panel writes the two font stacks as inline custom properties (`--dsw-font-family`, `--ds-font-family-code`) on `<html>`, which win the cascade over the host theme's `:root` definitions; every derived token (markdown code fonts, brand font, terminal) resolves dynamically. Choosing *Default* removes the override.

## Where settings live

Font choices persist in the browser's `localStorage`. Fonts are a property of the rendering environment — each browser and machine has its own installed fonts — so, like the host's own GUI preferences (session order, code-work options), the setting stays browser-local instead of being synced through the host profile. The font size needs no local copy: the theme service already persists it host-side.

The host half is intentionally empty: no Host service, no RPC, no model calls.

## Install

Install the preview channel (DSH 0.2.0-rc.2 or later):

```bash
dsh plugin --profile web add @klarkxy/dsh-font@next
```

Replace `web` with your profile name and restart the profile (or reload the page) after installing. Open **Plugins → Font** to change fonts.

## Development

```bash
pnpm --filter @klarkxy/dsh-font build       # tsdown + client wrapper
pnpm --filter @klarkxy/dsh-font typecheck
pnpm --filter @klarkxy/dsh-font test
```

Preview releases use the npm `next` tag. The stable plugin-site catalog requires a `latest` release.
