# Context Cleaner

<!-- release-state-note -->

[简体中文](README.md) / English

Hides the plugin-info and promotion cards at the top right of the `dsh-context` dashboard so the stats card fills the header row.

## Install

Install and enable `dsh-context` first — this plugin only styles the panel and does not provide the context dashboard itself.

```sh
dsh plugin --profile web add @klarkxy/dsh-context-cleaner
```

Replace `web` with your profile name, restart the profile if prompted, and ensure **Context Cleaner** is enabled in the plugin list. No additional configuration is required.

## Usage

Works automatically while enabled with no manual steps. Both the context tab and the sidebar entry of `dsh-context` keep the plugin-info and promotion cards hidden and collapse that column cleanly. Disabling or uninstalling the plugin removes the stylesheet and restores the cards.

## Limitations

- Hiding relies on `dsh-context`'s rendered DOM structure and layout; an upstream redesign may require updating this plugin.
- Visual hiding only — `dsh-context` still performs its recommendation fetch in the background.

## License

[SATA License 2.1](LICENSE)
