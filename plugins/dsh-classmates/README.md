# Teammate Roles

[中文说明](README.zh-CN.md)

Configure reusable roles for native DSH subagents and Team teammates in one place. Creator mode edits the shared role library; DSH owns child execution, messages, tasks and sessions.

**Experimental local build: 0.2.0-alpha.1. Target host: DSH Web 0.1.7-rc.2, Node.js 24, Windows.** The official `@deepseek-ai/dsh-experimental-agent-team-profile` bundle is optional and required only for Team collaboration.

## Install and use

Install the local tarball through the native Plugins page, or:

```powershell
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-classmates-0.2.0-alpha.1.tgz"
```

Restart that profile. In **Plugins → Classmates**, edit responsibilities and instructions on the Templates page, and model, reasoning effort and purpose on the Models page. Templates need no model binding. You can also describe the changes in DSH's built-in **Creator** mode. Its top-level agent receives `classmates_read`, `classmates_batch` for template edits, and `classmates_models_batch` for model-profile edits. These tools share the same configuration as the UI and remain available with an empty or disabled template library. Ordinary sessions, subagents and teammates cannot edit this configuration. Changes apply to future delegations, not the current chat or existing children.

The delegating agent sees enabled model profiles and chooses one through the existing tool's `model_profile` parameter. Multiple profiles can use the same model with different efforts and purposes. An omitted profile effort uses the selected model's default. Selection, retries and recovery decisions belong to the delegating agent; Classmates adds no automatic model rotation or fallback. Profiles are user guidance, not evidence of connectivity or model quality.

Enable **使用前确认** (approval before use) on the Models page to require native DSH approval whenever Classmates creates a new child using that provider/model route. All purposes and reasoning efforts share the setting; deleting a profile does not remove protection. Approval covers one creation, not each request or follow-up to an existing child. Rejection, cancellation or an unavailable approval channel prevents creation without automatic fallback.

Creator mode can configure protection through `classmates_model_protection`; removing existing protection through that tool also requires native approval. Users can change the switch directly in the UI. The host's approval answerers remain authoritative: Safe Auto in smart mode delegates these requests to the next answerer, while unattended mode rejects them. This is a Classmates creation control, not a spending cap or host-wide model firewall. The native generic `subagent`, other plugins and direct host configuration edits are outside its scope.

The separate role configuration assistant preset has been removed. Existing role data and session records are preserved; old assistant sessions are not silently converted into Creator sessions. Start a new Creator session for further configuration.

The role list includes 11 disabled presets: Explorer, Researcher, Planner, Ideator, Griller, Implementer, Reviewer, User Tester, Overdesign Guard, Writer and Verifier. Existing installations can add a preset as a new role without overwriting their library. Credentials stay in the host.

Ask the Lead explicitly to use a Classmates role and collaborate through official Team messages/tasks. `classmates_list` returns short role descriptions; `classmates_spawn` takes a role ID, its listed revision, a lowercase hyphenated teammate name, and a task. Long instructions are scoped to that teammate. An empty usable catalog removes both discovery tools. The plugin does not automatically create members or send requests.

## Native subagents

Enable a role, then ask a session with native subagent delegation to use it: “Delegate a review to the Reviewer role, then address its findings.” Each enabled role composes an official delegation tool such as `subagent_reviewer`; the agent sees its name and responsibility. The original unconfigured `subagent` keeps the host defaults.

Role tools use the native `spawn` backend. Background calls create continuable subagents with native follow-up messages, interruption, completion notifications and session navigation. `run_in_background: false` waits for a one-shot result and disposes that child. Native depth, capacity, permissions and cancellation still apply. Presets without the ordinary `subagent` entry do not gain delegation through Classmates.

A selected model profile supplies the child's model and effort together. Without a profile selection, existing template overrides and independent inheritance from the calling chat remain compatible. DSH saves the resolved route and complete persona in its own child descriptor, so template and profile edits, disabling and deletion affect future children only. Ordinary children need no Team binding files. Keep Classmates installed when resuming role children: its small prompt compatibility hook preserves literal instructions, including `{{...}}`, instead of interpreting them as templates.

## Lifecycle and limitations

Template switches in the left list save immediately without submitting unsaved editor text. Use Save for name, description and instruction edits; maintain model profiles on the Models page. Disabling a template prevents new members from being created from it; existing members keep their saved configuration.

After configuring roles, choose **开始任务** (Start task) in the plugin settings page. This opens a fresh Standard session with an editable teammate summary; it does not send a message automatically or overwrite another session's draft. Public provider labels help distinguish model routes. Catalog membership does not establish connectivity.

Existing teammates retain immutable creation snapshots after a role is edited, disabled or deleted. Bindings live in the profile's `data/classmates`; retain them with the original profile and sessions when recovering. Invalid or missing bindings reject plugin-member activation instead of silently selecting the Lead's model. Snapshot checksums detect corruption, not malicious local modification.

End affected teammates before uninstalling. Ordinary Lead sessions remain usable, but recovery of Classmates members requires this plugin. Hot-unloading active plugin members does not preserve routing guarantees. Reinstall and restart before recovering them.

The enhanced native Team action displays frozen role names, stable member identities and last recorded request models. Before the first request, configured models are labelled as configuration. Unknown metadata does not borrow the Lead's model. Native task ownership, blockers and conversation navigation are retained. Unloading the UI restores the original entry through official slot shadowing.

Instructions are not a permissions sandbox. Members use official workspace/tool permissions and may share a working directory. Without a selected model profile, blank legacy model and effort fields independently inherit the spawning chat's configuration. Incompatible inherited effort rejects creation with a clear error. Saved child routes remain stable for recovery. Displayed request routes do not establish the hidden model behind a proxy alias.

The previous 0.1.0-alpha.1 build completed real-model acceptance through local OCG; that is historical evidence, not a fresh provider check for this build. See the [enhancement acceptance record](docs/enhancement-acceptance.zh-CN.md) and [compatibility baseline](docs/compatibility.md). Other host versions and clients remain unverified.

## Development

```sh
cd ../..  # monorepo root
pnpm install --frozen-lockfile
pnpm --filter @klarkxy/dsh-classmates check
pnpm --filter @klarkxy/dsh-classmates pack
```

The default test suite uses the installed official runtime with deterministic local model capture. Live acceptance helpers under `scripts/` require an isolated configured profile and explicitly supplied credentials via environment. `browser-acceptance.mjs` uses local Edge and `DSH_ACCEPTANCE_URL`; it mutates a temporary test role. Never point it at an important profile without accounting for those writes.

No npm publication or release has been performed. A public license has not been chosen (`UNLICENSED`). Include exact versions and sanitized reproduction details in issues; never include credentials or complete private sessions. See `THIRD_PARTY_NOTICES.md` for the upstream test helper attribution.

This source is maintained in `dsh-plugins/plugins/dsh-classmates` and marked `private: true` to prevent automatic publication. Historical demo scripts require recordings and local model configuration retained in the original `dsh-teammates` directory; these are not needed for build or tests. Historical acceptance records retain their original paths and do not certify this migration.
