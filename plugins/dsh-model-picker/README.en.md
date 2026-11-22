# Model Picker

<!-- release-state-note -->

[简体中文](README.md) / English

Replaces the model button in the DeepSeek Harness composer: pick a model and reasoning effort from a periodic-table style card grid, or switch back to a searchable list. Other plugins can reuse the same picker.

## What it does

### Card view (default)

One card per model: a sequence number at the top left, the provider at the top right, a large short name with a numeric superscript, full qualifier text and the full model name in the middle, and reasoning-effort cells along the bottom.

- **Filter**: just start typing once the panel is open. Matches model names, short names and providers (`gpt5` also finds `gpt-5`). Enter picks the first result; Escape clears the filter first, then closes.
- **Pick a model**: click the middle of a card. This selects the model without setting reasoning effort.
- **Pick a model and effort**: click an effort cell at the bottom. Click the selected cell again to clear the effort.
- **Switch providers**: when several providers serve the same model, they share one card; switch with the button at the top right. The current effort is kept if the new provider supports it.
- **Short names**: common models show a recognizable vendor or model name (such as `Kimi`, `Terra`, `DeepSeek`, or `Opus`). Numeric versions appear as superscripts, while qualifiers such as `Flash`, `Pro`, and `Lightning` are spelled out in small text; other models use their complete first name word. Double-click a short name to rename it: Enter saves, Escape discards, and an empty name restores the default.
- **Layout**: drop a card on either edge of another card to insert it there, or on the center to swap the two. The slider at the top sets card width, and **Reset layout** clears the custom order and short names.
- **Right-click menu**: right-click a card to favorite it (favorites come first and show a ★), move it to the front or end, rename or restore its short name, copy the model ID, or hide it. Hidden models can be shown again with the **Hidden** button at the top and unhidden from there.
- **Motion**: the panel, cards and menus fade and slide in, and cards glide into place when reordered. All motion turns off when your system's reduced-motion setting is on.

### List view

Click **List** at the top for a searchable list grouped by provider, with a slider for reasoning effort. Click **Cards** to go back.

### Other behavior

- The model and effort you pick become the defaults for new sessions.
- In list view, switching back to a model you used since opening the page restores its last effort.
- If the model list fails to load, you can retry. A saved model that is no longer in the catalog is marked and cannot be picked again.
- Subagent sessions do not offer model selection, matching the native button.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-picker
```

Replace `web` with your profile name and restart the profile. No configuration is needed.

If `reasoning-slider` is also installed, this plugin takes precedence. Disabling or removing it brings back `reasoning-slider` or the native button.

## Other plugins

Feature plugins can mount this picker in their own settings pages or cards. Without this plugin, those features keep their existing menus. See `@klarkxy/dsh-model-route` for how to integrate.

## Limitations

- Only the composer model button and the shared picker are replaced; the Settings → Models page is unchanged.
- View, card width, order, favorites, hidden models, custom short names, and preferred providers are stored in the current browser only and do not sync across devices.
- After DeepSeek Flash cards are merged across providers, preferences saved under the old card key—order, favorites, hidden state, custom short names, and preferred provider—are not migrated; set them again after upgrading.

## License

[SATA License 2.1](LICENSE)
