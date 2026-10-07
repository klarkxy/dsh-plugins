# @klarkxy/dsh-model-hub

Cross-plugin model settings hub for DeepSeek Harness — **development preview**.
The plugin page lists and edits live model-route fields through the native
settings service. This build also reports:

1. Which installed plugins expose model-route fields in their
   `settings.describe()` projection (detected via `@klarkxy/dsh-model-route`,
   marker or bare shape)?
2. Do custom schema markers survive the host projection? The hub's own Config
   carries two self-test fields — one marked with the custom `x-model-route`
   key, one with schemastery's renderer-role channel.

The report is logged and written to `<profile>/data/model-hub/probe-report.json`,
and refreshed on every `settings/document-updated` event.

Existing array items appear as separate rows with numeric indices. Empty
collections show an informational row; add an item in the owning plugin
before editing it here. Writes revalidate the target against a fresh native
projection and use the descriptor revision for CAS. Follow mode preserves
array elements, and unrelated settings stay with their owning plugin.

Both self-test fields are individually volatile, so the native settings
projection includes them without exposing ordinary configuration. Per-day
usage metering is not included in this preview.

## Install

Requires DSH 0.2.0-rc.2 or later. Install the preview channel, restart the profile, then open Plugins → Model Hub:

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub@next
```

## License

SEE LICENSE IN LICENSE
