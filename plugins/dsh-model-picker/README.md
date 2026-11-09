# Model Picker

Searchable model selection with a reasoning-effort slider for the DeepSeek Harness composer — and the same picker as a reusable component that other plugins can mount.

<!-- release-state-note -->

## What it does

- Replaces the composer model button with a single-pane picker: a searchable model list grouped by provider, plus a thick gradient reasoning-effort slider with a larger handle and drag feedback. Motion follows your system's reduced-motion preference.
- Successful model and effort selections become the defaults for new sessions. Switching back to a model used during this page visit restores its last selected effort when still supported; otherwise it follows the model default. Choosing Default clears the explicit effort.
- Choosing a model or adjusting its effort keeps the panel open, preserving the search and scroll position. Loading failures offer a retry; a saved model that is no longer routable is marked and cannot be re-picked.
- Model selection is unavailable in subagent sessions, matching the native picker.

## Install

The plugin needs no configuration; enable it and the composer model button is replaced.

With this plugin and `reasoning-slider` both installed, this picker wins. Disabling or removing it restores whichever picker was active before — `reasoning-slider`, or the native button.

## Other plugins

Feature plugins can mount the same picker in their own settings and cards. Mounting is optional: while this plugin is absent each feature keeps its existing menu, so nothing breaks when it is disabled or uninstalled. Consumers should refer to the shared contract in `@klarkxy/dsh-model-route`.

## Limitations

- Covers the composer model button and the shared picker; the Settings → Models page keeps its native layout.
- A saved model that left the catalog stays shown but is marked not routable and cannot be re-picked.
