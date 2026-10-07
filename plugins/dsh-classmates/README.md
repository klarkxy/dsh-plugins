# Teammate Roles

[简体中文](README.zh-CN.md)

Teammate Roles keeps one shared role library for native DSH subagents and Team teammates: responsibilities, working instructions, models and reasoning efforts live in the same place, and a session uses them by name. You can also drive the same configuration through a chat in DSH's built-in Creator mode. Version `0.2.0-rc.1` uses the npm `next` preview channel.

**Runtime**: Node ≥ 24, DSH ≥ 0.2.0-rc.2; only **DSH Web 0.2.0-rc.2 / Windows** is in scope for this worktree. Team collaboration additionally needs the official `@deepseek-ai/dsh-experimental-agent-team-profile` bundle; ordinary subagents do not. DSH still owns delegation, messages, tasks and sessions: this plugin does not replace the official messages, task board, members or session management.

## Install

1. Check that `dsh --version` reports `0.2.0-rc.2`.
2. For Team collaboration, enable the official Agent Teams bundle `@deepseek-ai/dsh-experimental-agent-team-profile` on the target Web profile's native Plugins page.
3. Install the preview channel:

   ```powershell
   dsh plugin --profile web add @klarkxy/dsh-classmates@next
   ```

4. Restart the target profile, then open **Plugins → Classmates**. For a custom profile, replace `web` in the command with its name.

The bundle order used in tests is `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-experimental-agent-team-profile`, `@klarkxy/dsh-classmates`.

## First use

**Configure by hand**: in **Plugins → Classmates**, edit responsibilities and instructions on the Templates page, and model, reasoning effort and purpose on the Models page. Templates need no model binding. Roles are stored in host configuration and model credentials stay with the host; this plugin has no credential field.

**Configure in a chat**: start a session in DSH's built-in **Creator** mode and describe the change, for example "add implementation and review templates, then configure this model at high for complex review work". Its top-level agent receives `classmates_read` to read templates, model-profile purposes and the host catalog, `classmates_batch` for template edits, and `classmates_models_batch` for model-profile edits. These tools share the same configuration as the UI and can still run ordinary tasks and Team collaboration afterwards.

Configuration tools are exposed to the Creator-mode top-level agent only. Ordinary sessions, subagents and teammates cannot edit this configuration. They remain available with an empty or disabled template library, so Creator mode can still configure the first roles. Model and effort edits change future members' templates; they never switch the current chat or existing children.

Built-in working instructions and the Creator-mode role configuration prompts are written in English; interface text and replies stay in Chinese or the language you request. Existing custom roles are never rewritten.

The separate role configuration assistant preset has been removed. Existing role data and session records are neither migrated nor deleted, and old assistant sessions are not silently converted into Creator sessions. Start a new Creator session for further configuration.

**Start task**: after configuring, choose **Start task** in the plugin settings page. It opens a fresh Standard session with an editable teammate summary; fill in the task and send it. The original session and its draft are preserved, and no message is sent automatically. Public provider labels help distinguish model routes; catalog membership does not establish connectivity.

**Ask for Team collaboration**: request it explicitly in an ordinary session, for example:

> Use the Researcher role from Classmates to investigate this and send you the evidence; you summarize the final answer. Use official Team messages and shared tasks.

The lead then receives `classmates_list` and `classmates_spawn`: the first returns short role descriptions and model-source metadata. Omitting `model_profile` uses the role's saved source: inherit the calling chat, use a bound model preset, or use a specific model. Pass `model_profile` to override that source for one creation. Long instructions are scoped to that teammate. An empty usable catalog removes both discovery tools. Directory queries create no members, and the plugin never sends requests by itself; later collaboration uses the official Team tools.

**Role list**: 12 disabled presets ship with the plugin — Researcher, Writer, Verifier, Advisor, Explorer, Planner, Ideator, Griller, Implementer, Reviewer, User Tester and Overdesign Guard. Advisor is read-only consultation: it does not implement, verify or accept. Existing installations can add a preset as a new role and enable it when needed; it never overwrites the existing library.

The role editor saves model-source changes immediately, separately from unsaved role text. A model preset is a strong binding: deleting or disabling it makes future dispatch fail until you change the source or pass an explicit per-call override. Legacy `recommendedModelProfileId` values become bindings when there is no fixed model; a legacy fixed model takes precedence and the old recommendation remains only as a migration note. Classmates does not silently rebind, fall back or recreate a preset.

## Model profiles and approval

The delegating agent sees enabled model profiles and chooses one through the existing tool's `model_profile` parameter. Multiple profiles can use the same model with different efforts and purposes. An omitted profile effort uses the selected model's default. Selection, retries and recovery decisions belong to the delegating agent; Classmates adds no automatic model rotation or fallback. Profiles are user guidance, not evidence of connectivity or model quality.

Without a per-call profile selection, the role's saved source applies. A specific model with unset effort inherits the dispatching conversation's effort; an incompatible effort rejects creation. A bound or per-call profile instead supplies model and effort together, using the model default when effort is unset. The resolved configuration is saved at creation time, so later template or profile edits, disabling and deletion do not rewrite existing instances.

Enable **使用前确认** (approval before use) on the Models page to require native DSH approval whenever Classmates creates a new child using that provider/model route.

- All purposes and reasoning efforts of that provider/model share the setting; deleting a profile does not remove protection.
- Approval covers one creation, not each request or follow-up to an existing child.
- Rejection, cancellation or an unavailable approval channel prevents creation without automatic fallback.

Creator mode can configure protection through `classmates_model_protection`; removing existing protection through that tool also requires native approval. Users can change the switch directly in the UI. The host's approval answerers remain authoritative: Safe Auto in smart mode delegates these requests to the next answerer, while unattended mode rejects them.

Boundary: this is a Classmates creation control, not a spending cap or host-wide model firewall. The native generic `subagent`, other plugins and direct host configuration edits are outside its scope.

## Native subagents

Enable a role, then ask a session with native subagent delegation to use it: “Delegate a review to the Reviewer role, then address its findings.” Each enabled role composes an official delegation tool such as `subagent_reviewer`; the agent sees its name and responsibility, and responsibilities, models and reasoning efforts all come from the same role configuration. The original unconfigured `subagent` keeps the host defaults.

- Role tools use the native `spawn` backend. Background calls create continuable subagents with native follow-up messages, interruption, completion notifications and session navigation; `run_in_background: false` waits for a one-shot result and disposes that child. Native depth, capacity, permissions and cancellation still apply. Presets without the ordinary `subagent` entry do not gain delegation through Classmates.
- A selected model profile supplies the child's model and effort together. Without a profile selection, existing template overrides and independent inheritance from the calling chat remain compatible, and an incompatible inherited effort rejects delegation. Ordinary children need no Team binding files.
- DSH saves the resolved route and the complete persona in its own child descriptor, so template and profile edits, disabling and deletion affect future children only; recovering an existing child does not read the latest template.
- Keep Classmates installed when resuming role children: its small prompt compatibility hook preserves literal instructions, including `{{...}}`, instead of interpreting them as templates.
- Role delegation is offered only in sessions where the native `subagent` entry is available. Without Team enabled, Creator mode can still configure roles.

## Team panel

The enhanced native Team action displays frozen role names, stable member identities and last recorded request models. Before the first request, configured models are labelled as configuration. Unknown metadata does not borrow the Lead's model. Native task ownership, blockers and conversation navigation are retained. Unloading the UI restores the original entry through official slot shadowing. An idle member does not mean its task is finished.

## Editing, recovery, and uninstall

- Template edits, disabling and deletion affect only members created afterwards. Existing members keep the model, effort and instructions frozen at creation time.
- Template switches in the left list save immediately without submitting unsaved editor text. Use Save for name, description and instruction edits; maintain model profiles on the Models page. Disabling a template prevents new members from being created from it; existing members keep their saved configuration.
- Saving settings performs a version check. On a concurrent change the local input is kept, the remote version can be read for comparison, and the user then explicitly chooses to overwrite it or discard the local edit.
- Existing teammates retain immutable creation snapshots after a role is edited, disabled or deleted. Bindings live in the profile's `data/classmates`; keep them with the original profile and sessions when recovering, and do not copy a single Session alone. Invalid or missing bindings reject plugin-member activation instead of silently selecting the Lead's model. Snapshot checksums detect corruption, not malicious local modification.
- **End affected teammates and sessions before uninstalling.** Ordinary Lead sessions remain usable, but recovery of Classmates members requires this plugin. Hot-unloading active plugin members does not preserve routing guarantees. Reinstall and restart before recovering them.
- Working instructions such as “read-only” or “researcher” are not a permissions sandbox. Members use official workspace/tool permissions and may share a working directory. Without a selected model profile, blank legacy model and effort fields independently inherit the spawning chat's configuration, and incompatible inherited effort rejects creation with a clear error. Saved child routes remain stable for recovery, and displayed request routes do not establish the hidden model behind a proxy alias.

## Acceptance and limitations

The previous 0.1.0-alpha.1 build completed real-model acceptance through local OCG with `mimo-v2.6-flash`, `minimax-m3` and `step-5-preview`; MiniMax's `high` effort was checked against the parameters actually sent, and an old member kept its route after a separate restart and a template deletion. Settings-page create/update/delete, dual-window conflict, 320px narrow layout and the host dark theme are part of the browser acceptance. That is historical evidence, not a fresh provider check for this build.

Scope and evidence: [enhancement acceptance record](docs/enhancement-acceptance.zh-CN.md) · [compatibility baseline](docs/compatibility.md). Model internal reasoning, other DSH versions and Desktop/CLI/Spaces/Editor remain unverified, and upgrading the host requires a new acceptance run.

## Development and feedback

```sh
cd ../..  # monorepo root
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-classmates check
pnpm --filter @klarkxy/dsh-classmates pack
```

The default test suite uses the installed official runtime with deterministic local model capture. `scripts/acceptance-host.mjs` is a local acceptance host that runs against an isolated `DSH_HOME`; it needs the profile's model list configured in advance and inherits credentials only from the environment. `scripts/browser-acceptance.mjs` uses local Edge and `DSH_ACCEPTANCE_URL`, and it creates then deletes one test role. Never point it at an important profile without accounting for those writes. Live-model tests consume model quota; the routine unit tests do not.

Model-source UI regression: run `node scripts/recommendation-browser.mjs` from this package, or use its path from any working directory. It bundles the actual React pages, starts isolated in-memory CAS storage on a free localhost port, and opens headless Edge. It checks inherit/profile/fixed controls, immediate saves, two-editor conflicts, disabled/missing bindings, keyboard tabs and mobile width. No build, DSH installation, credentials or model calls are required. The fixture uses host primitive test doubles; it proves source UI behavior, while native package tests and isolated host acceptance cover dispatch and runtime loading separately.

Offline Fusion archive (does not scan `.dsh` or edit settings):

```sh
npm run build
node dist/migrate-fusion.js --fusion fusion-store.json --output classmates-merged.json [--classmates classmates-export.json] [--archive archive-dir-or.html]
# source checkout: node scripts/migrate-fusion.mjs …
# after install: node node_modules/@klarkxy/dsh-classmates/dist/migrate-fusion.js …
```

See [docs/fusion-migration.md](docs/fusion-migration.md). Local apply/cutover belongs to primary.

The plugin uses SATA 2.1; see `LICENSE` and `THIRD_PARTY_NOTICES.md` for third-party attribution. Preview releases use `next` and stay outside the stable plugin-site catalog until a `latest` release. Report problems with the `.github/ISSUE_TEMPLATE/bug_report.md` template: include exact versions, sanitized routes, reproduction steps and whether recovery is involved, and never include credentials or complete private sessions.

This source is maintained in `dsh-plugins/plugins/dsh-classmates`. Historical demo scripts require recordings and local model configuration retained in the original `dsh-teammates` directory; these are not needed for build or tests. Historical acceptance records retain their original paths and do not certify this migration.
