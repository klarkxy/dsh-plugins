# Model Picker

<!-- release-state-note -->

[简体中文](README.md) / English

Searchable model selection with a reasoning-effort slider for the DeepSeek Harness composer, plus a shared picker that other plugins can reuse.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-model-picker
```

Replace `web` with your profile name and restart the profile. No configuration is needed; enabling the plugin replaces the composer model button.

When both this plugin and `reasoning-slider` are installed, this picker takes precedence. Disabling or removing it restores whichever seat was active before (`reasoning-slider` or the native model button).

## Usage

- **Search and reasoning slider**: Open the composer model button for a single-pane list grouped by provider with a reasoning-effort slider underneath; animations respect your system's reduced-motion preference.
- **New-session defaults and page-level memory**: Confirmed model and effort selections become the defaults for new sessions. Switching back to a model used during the current page visit restores its last selected effort if still supported, or falls back to the model default; choosing **Default** clears the explicit effort.
- **Stays open while adjusting**: Picking a model or adjusting reasoning effort keeps the panel open with search text and scroll position intact; loading failures provide a retry action.
- **Optional plugin integration**: Other feature plugins can mount the same picker through the shared `@klarkxy/dsh-model-route` contract. Integration is optional—when this plugin is absent or disabled, those plugins fall back to their existing menus without breaking.

## Limitations

- Covers only the composer model button and the shared picker; **Settings → Models** keeps its native layout.
- Model selection is unavailable in subagent sessions, matching native behavior.
- A saved model that is no longer in the available catalog remains visible, but is marked unroutable and cannot be selected again.

## License

[SATA License 2.1](LICENSE)
