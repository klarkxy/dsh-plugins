# @klarkxy/dsh-model-hub

<!-- release-state-note -->
The [repository registry](../../README.md#plugin-lifecycle) tracks Draft → Testing → Published, moving forward only. Fixes, testing and version updates keep published packages Published; each update still passes release checks. First publication explicitly selects Testing packages and records Published only after npm archive verification. See the [release guide](../../RELEASING.md).

Cross-plugin model settings hub for DeepSeek Harness — **development preview**.
Open Plugins → Model Hub to search by plugin, purpose or current model and edit
models from one compact list. Changes save immediately through the owning plugin.
Open plugin pages automatically reload saved model changes. Unsaved drafts stay
in place with a conflict notice; reload explicitly discards them. Reconnecting
reloads the current settings, and subscription failures expose manual refresh.

The hub includes Current Title, Git Commit, Safe Auto and ChatGPT when their
matching updated plugins are loaded. ChatGPT uses its separate Codex model
catalog and default.

The Subagent Cast tab manages the host's subagent model allowlist: the enable
switch and adding, replacing or removing models all write straight into the
native `subagent-model-selection-settings` settings with revision conflict
protection, so the host constraint keeps applying. Each model can also
carry a free-text "task tendency"; tendencies live in
`<profile>/data/model-hub/cast.json` and are injected into the system prompt as
read-only advisory hints — the main agent consults them and still makes the final
model choice when delegating. With this tab in place, the field matrix no longer
shows a duplicate editor for these native settings.

Add a model before enabling the cast; removing its last model also disables it.
The allowlist constrains explicit subagent model choices; omitting a model still
inherits the parent session. Tendencies have their own persisted revision and
conflict checks across open pages. Existing v1 files migrate on the first
successful save. A damaged or unreadable tendency file stays untouched and
shows a recovery error; native cast controls remain available.

Third-party volatile model-route fields are also discovered through native
`settings.describe()`. Plugins storing settings elsewhere can contribute fields
using `@klarkxy/dsh-plugin-kit/model-settings`; the hub does not inspect private
storage. Discovery handles deep schemas, arrays, dictionaries and intersections.

Refresh reloads both settings and model catalogs. Failed sources remain visible,
and a rejected save requires refresh and a fresh selection. Revision checks and
owner instance IDs protect against edits from stale pages. Other settings remain
with their owner, including sibling values inside native model objects.
A completed save is acknowledged separately from refreshing the page. If that
refresh fails, the page says the change was saved and offers refresh without
repeating the write.

The diagnostic report separately answers:

1. Which installed plugins expose model-route fields in their
   `settings.describe()` projection (detected via `@klarkxy/dsh-model-route`,
   marker or bare shape)?
2. Do custom schema markers survive the host projection? The hub's own Config
   carries two self-test fields — one marked with the custom `x-model-route`
   key, one with schemastery's renderer-role channel.

The report is logged and written to `<profile>/data/model-hub/probe-report.json`,
and refreshed on every `settings/document-updated` event.

Existing native array items appear as separate rows. Empty collections show an
informational row; add an item in the owning plugin first. Restoring a native
field returns to the plugin's inherited/default settings; clearing a direct
array route preserves the element. Owner fields explain their own default mode.

Both self-test fields remain in the diagnostic report and are hidden from the
model selection page. Per-day usage metering is not included in this preview.

## Install

Requires DSH 0.2.0-rc.2 or later. Install the preview channel, restart the profile, then open Plugins → Model Hub:

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub@next
```

## License

SEE LICENSE IN LICENSE

## Verification

`pnpm test:e2e:model-hub` checks the registered settings page in an isolated
Chromium browser, including keyboard selection, conflict recovery, catalog
separation and desktop/mobile layout. It uses the repository's UI primitive
stub and a real Cordis contribution bus; it does not activate an installed
Desktop profile. Adapter tests use the owning services and native SettingsForms.
