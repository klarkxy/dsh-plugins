# Compatibility and acceptance — 2026-09-25

This is the historical baseline. Current preset and inheritance changes are recorded in [preset acceptance](preset-acceptance.zh-CN.md).

Local candidate: `@klarkxy/dsh-classmates@0.1.0-alpha.1`. No publication, remote deployment or release was requested or performed.

## Tested environment

| Component | Actual tested combination |
| --- | --- |
| Host | DSH Web `0.1.7-rc.2` with official experimental Agent Teams bundle |
| Runtime | Windows, Node.js `24.16.0`; Cordis `4.0.4` |
| Client | Local Microsoft Edge through Playwright `1.58.2` |
| Profile | Dedicated `acceptance` profile under the repository's ignored `.test-output/clean-home` |
| Installation | Local `.tgz` installed into that clean profile; Host and Client loaded from its package; core packages resolved from the host |
| Models | One configured local OCG provider, OpenAI-compatible transport |

| Model ID | Selected effort | Observed result |
| --- | --- | --- |
| `mimo-v2.6-flash` | Default / omitted | Short task completed; model-driven discovery, creation and native message/task calls completed |
| `minimax-m3` | `high` | Short task completed; outgoing `reasoning_effort: high`; independent-process recovery retained the same route after template deletion |
| `step-5-preview` | Default / omitted | Short task completed |

These are plugin routing and transport checks. They do not measure model quality, latency, cost, internal reasoning compute, or independent cross-provider compatibility. MiniMax returned think-tag text alongside its short answer; an exact-format answer is not claimed for that model.

## Design acceptance coverage

| Gate | Evidence |
| --- | --- |
| Clean installation | Profile contains this external package only; installed Host/Client byte hashes match `dist`; native Web page loaded without a plugin error |
| Ordinary use | Defaults disabled/unbound; directory query creates no members; ordinary spawn and Lead route remain unchanged in runtime tests |
| Save validation | Missing route, unsupported effort, native settings revision and durable role revision checks; browser conflict keeps the draft and permits comparison/reload |
| First request / isolation | Installed official runtime captures two concurrently created members with separate route/effort/instructions on their first requests |
| Default effort | Captured member request clears the Lead's inherited effort; browser model switch clears a stale selected effort |
| Instruction scope | Literal braces stay literal; long instructions reach only the correct member, including retry and recovery |
| Native collaboration | Real models executed official `team_task_create` and `send_message`; durable tool results verify task creation and accepted/queued messages; member replied `ACK_RECEIVED` |
| Retry / duplicate creation | Frozen retry route; identical lost-receipt retry returns the same member without a second initial task; conflicting retries reject |
| Cold recovery | New Context deterministic test plus separate OS process using persisted sessions; Writer template deleted before resuming the old member |
| Error exposure | Missing/corrupt binding, unavailable model, invalid effort and unsupported one-shot activation reject; no parent-route fallback observed |
| Disable / unload | Spawn/discovery tools removed when no usable enabled roles remain; Creator configuration tools stay available; activation reconciles already-existing Leads; unload removes tools while preserving the Lead |
| Real models | All three requested models completed; safe request/turn/tool metadata exported from durable session events |
| Settings page | Create, update, delete, saved-state interaction, dual-page conflict, 320px overflow check and native dark theme verified by browser script |

Automated checks run on the actual installed DSH runtime with a local capture adapter. The test SessionQuery helper is adapted from the exact upstream release; that is distinct from the separate full Web-host and provider checks. The acceptance exporter asserts durable completion markers and successful tool results rather than relying on model self-report or an inactive roster status.

## Evidence and reproduction

- [Sanitized live request and tool evidence](evidence/live-acceptance.json)
- [Browser workflow results](evidence/browser-acceptance.json)
- `npm run check`: type checking, deterministic tests, production build.
- `scripts/acceptance-host.mjs`: dedicated Web test host with `run`, `recover`, `empty`, `team`, `state` and `stop` commands. Configure its isolated model setup first; credentials are inherited through the environment only. `run` expects the original three presets. `recover` deliberately deletes the Writer template in this test profile.
- `scripts/export-acceptance.mjs`: reads synthetic sessions and exports only selected route/tool/turn metadata; `DSH_TEAM_LEAD_ID` identifies the synthetic Team example.
- `scripts/browser-acceptance.mjs`: `DSH_ACCEPTANCE_URL` selects the test host; creates/deletes a temporary role and changes that test profile's theme.

One initial model-driven spawn omitted revision and used an invalid name. Validation rejected both attempted calls before creation; the model corrected its arguments and completed. Tool parameter descriptions were clarified afterward. The first Team test harness incorrectly waited for an exact teammate name the model did not use, despite completed durable events; the exporter independently verified the completed workflow, and the harness now checks native teammate membership. A second harness check originally omitted the tool registry's Agent scope; it was corrected. None of these runs were counted as passed script runs.

## Explicit limits

- Stop affected members before uninstalling. Hot unloading active Classmates members removes the hooks that enforce their selection, so continuing those members is unsupported. Missing-plugin cold recovery is unsupported as well: reinstall, restart, and keep the binding files before recovering. Ordinary Lead use is unaffected.
- Snapshot files are atomically replaced with the official host writer and protected by its cross-process file lock. This does not claim power-loss durability or hostile local modification resistance.
- The official rc.2 roster model label may show the Lead's model; inspect actual request metadata. A creation receipt's `selected` field is intended configuration, not proof that a request was sent.
- Permissions are official DSH permissions. Role instructions do not enforce read-only access or independent workspaces.
- Role settings register in `plugins.bundle.config` under `@klarkxy/dsh-classmates`, with no general-settings entry. The layout responds to the plugin panel width and never restyles host containers. Controls and colors use official DSH primitives and theme tokens. Host upgrades require browser and layout regression checks.
- No compatibility claim for other DSH versions, direct provider combinations, CLI-only, Desktop, Spaces or Editor. No telemetry service is added.

### Plugin settings migration (2026-09-26)

Classmates now registers its form in the package detail page through the official keyed `plugins.bundle.config` slot. The general-settings entry is removed. Existing role configuration and revision checks are unchanged; no data migration is required.

The isolated rc.2 browser run passed creation, native role switch, save/reload persistence, two-page conflict recovery, deletion, 320px layout with the host sidebar collapsed, dark theme, component disable and re-enable, and navigation to the role assistant and a new task. No browser errors occurred. See [the current report](evidence/plugin-settings-browser.json); the older reports above describe their own original runs.

For local reproduction, build and start `node scripts/plugin-settings-host.mjs`, then run `node scripts/browser-acceptance.mjs` with `DSH_ACCEPTANCE_URL` set to that host's printed URL, `DSH_ACCEPTANCE_MODEL_A=审查模型`, and `DSH_ACCEPTANCE_MODEL_B=界面模型`. The fixture uses only its own `.test-output/plugin-settings` profile and a local deterministic model adapter. Enter `stop` in the host to shut it down.

### Role list refinement (2026-09-26)

Role switches now save immediately from the list, using the last accepted role together with both the configuration and role revisions. They never submit the text editor's unsaved fields. Text saves preserve the list's accepted enabled state, and stale writes still require an explicit conflict review. Turning a role off prevents new Classmates members from using that template and leaves existing members untouched. Inheriting the chat model remains supported.

The layout uses a compact list with one-line descriptions, collapsed preset insertion, and a wider detail editor with paired model/effort fields. Design references: [Microsoft list/details](https://learn.microsoft.com/en-us/windows/apps/design/controls/list-details) and [Carbon immediate toggles](https://carbondesignsystem.com/components/toggle/usage/).

The [current browser report](evidence/role-list-browser.json) covers all 11 presets, immediate toggle persistence, same-role and other-role unsaved drafts, stale toggle rejection and refresh/retry, save conflicts, both themes, mobile layout, and component and navigation lifecycle. Set DSH_SETTINGS_ALL_PRESETS=1 when starting the isolated settings host to reproduce this fixture. The existing reports above keep their earlier evidence.

### Creator configuration tools (2026-09-26)

The separate classmates-manager preset and its launch button are retired. Built-in Creator (cordis) root agents receive classmates_read and classmates_batch in their own Agent scope, including empty/disabled role libraries. Normal Creator team/task tools and prompt sections remain. Both registration and dispatch check the actual composed preset and root/member identity; switching to Standard or unloading the plugin retracts registrations and invalidates captured handlers. The persistence schemas, role/model validation, atomic revision checks and frozen member snapshots are unchanged.

The old preset is no longer selectable. Historical configuration-assistant transcripts and role data are retained, but started old assistant sessions are not automatically reassigned to Creator. Use a new Creator session for further configuration. The removed package export ./manager is no longer a supported custom-preset entry.

Local reproduction: build the plugin, start scripts/enhancement-host.mjs with DSH_ENHANCEMENT_ROOT=.test-output/creator-integration and DSH_ACCEPTANCE_PORT=19447, then enter creator. This uses the official Web/Creator runtime and a deterministic local model adapter; it does not test live model reasoning. The earlier manager acceptance files describe the retired design.

Current evidence: [Creator tool/runtime checks](evidence/creator-configuration.json) and [settings browser regression](evidence/creator-settings-browser.json). The runtime checks use official preset composition and a local model capture; the empty-library hot-reload case uses the official Cordis runtime with a controlled preset identity fixture. No live provider reasoning was exercised in this change.
