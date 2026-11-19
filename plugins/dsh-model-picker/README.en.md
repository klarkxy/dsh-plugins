# Model Picker

<!-- release-state-note -->

[简体中文](README.md) / English

Dual-view model picker (periodic-table card grid and searchable list with reasoning-effort slider) for the DeepSeek Harness composer — and the same picker as a reusable component that other plugins can mount.

## What it does

- **Periodic-table card grid (default)**:
  - Each card shows its sequence number, a clickable provider dropdown at the top right, a large monospace short symbol with the full model name beneath, and a flush reasoning-effort strip along the bottom.
  - **Built-in short-name presets**: Includes presets for Gemini 4 element models (`H`, `He`, `C`, `Ne`, `Ar`, `Kr`, `Xe`, etc.), Claude (`Op`/`Fb`/`Sn`/`Hk`), DeepSeek (`Ds`/`Dr`/`Dc`), OpenAI GPT/Codex/o-series (`Gp`/`Cx`/`O3`/`O4`), xAI Grok (`Gr` with version superscripts such as `4.6` and `4.7` to keep parallel versions distinct), GLM, MiniMax, Kimi, Qwen, Step, and deterministic two-letter fallbacks. Double-click any symbol to edit a custom alias inline (clear to restore the preset).
  - **Multi-provider merging**: Identical canonical models exposed by multiple providers merge into one card with a provider dropdown; distinct versions stay separate cards with compact version superscripts.
  - **Optional reasoning effort**: Click the center of a card to select the model without sending `reasoningEffort`; click a bottom effort cell to select model + effort in one click, or click the active cell again to clear it.
  - **Resizable & reorderable**: Adjust card width live with the toolbar slider. Drag a card onto the left/right edges of another card to insert before/after, or onto the center to swap in place. Order, width, custom aliases, and preferred providers persist in browser storage.
- **Classic list view**: Toggle **Cards / List** to switch to the searchable provider-grouped list and discrete gradient reasoning-effort slider. Motion follows your system's reduced-motion preference.
- **Memory & status**: Successful model and effort selections become the defaults for new sessions. In list mode, switching back to a model used during this page visit restores its last selected effort when still supported. Choosing a model or adjusting effort keeps the panel open; loading failures offer a retry; a saved model that is no longer routable is marked and cannot be re-picked.
- Model selection is unavailable in subagent sessions, matching the native picker.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-picker
```

Replace `web` with your profile name and restart the profile. No configuration is needed; enabling the plugin replaces the composer model button.

With this plugin and `reasoning-slider` both installed, this picker wins. Disabling or removing it restores whichever picker was active before — `reasoning-slider`, or the native button.

## Other plugins

Feature plugins can mount the same picker in their own settings and cards. Mounting is optional: while this plugin is absent each feature keeps its existing menu, so nothing breaks when it is disabled or uninstalled. Consumers should refer to the shared contract in `@klarkxy/dsh-model-route`.

## Limitations

- Covers the composer model button and the shared picker; the Settings → Models page keeps its native layout.
- View mode, card width, custom order, aliases, and preferred providers are stored locally in browser `localStorage` and do not sync across devices.
- A saved model that left the catalog stays shown but is marked not routable and cannot be re-picked.

## License

[SATA License 2.1](LICENSE)
