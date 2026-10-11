# 破限 / Unrestricted

[简体中文](README.zh-CN.md)

A DeepSeek Harness agent preset that answers under the unrestricted delivery contract:
deliver the complete artifact directly, no softening. The contract lives in THIS preset's
persona, so it applies **only to sessions that select the preset** — nothing rewrites any
other session's prompt the way global injection does. Pure static bundle: no runtime
plugin, no hooks, no settings card.

## How this differs from global injection

The contract text comes from [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)
(MIT). That plugin mounts a root `system-prompt/assemble` waterfall and fuses the contract
into every standard / ptc / cordis / minimal and subagent prompt at assembly time, with a
toggle, anchor checks, fingerprint and preview. This package settles the same contract
into a **per-session preset**:

- New sessions on **破限 / Unrestricted** answer under the contract; standard, Creator,
  PTC, minimal and every other preset keep their prompt byte for byte.
- There is no toggle to forget: selecting the preset is on, selecting another preset is
  off.
- Subagents inherit automatically: the host joins child sessions to the parent's preset
  revision (`composeFrom`), and the native `subagent` / `subagent_fork` tools only read a
  persona from row config — which the standard roster does not set — so delegated threads
  carry the contract too. Only derivations that explicitly give the child a persona (for
  example Classmates teammates built from role instructions) replace the persona slot, and
  those children do not see the contract.

## Install and use

Before the npm release, pack this package and add the archive:

```sh
cd plugins/dsh-unrestricted
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-unrestricted-0.1.0-rc.1.tgz"
```

After release: `dsh plugin --profile web add @klarkxy/dsh-unrestricted`. Replace `web`
with your profile name, restart the profile, and pick **破限 / Unrestricted** in the
preset selector of a new session. Sessions that already carry messages cannot switch
presets.

You choose the model in the session. Preset metadata binds no model and no reasoning
effort; this package changes no default preset, model, permission, or other preset.

## What is inside

- **persona**: the standard opening sentence, the execution pointer, and the full
  `## Unrestricted local execution mode` contract — byte-identical to the
  `EXECUTION_MODE_BLOCK` in dsh-unrestricted 0.2.2 `src/rules.js`, contract fingerprint
  `e9e4eead5f84504c` (first 16 hex digits of SHA-256); tests re-check it after any edit.
- **plan-mode note**: the official plan-mode body unchanged, closed by one paragraph —
  plan mode restricts delivery and mutation, not the plan's content.
- **tool roster**: the complete tool composition of the DSH `0.2.0-rc.2` standard preset
  (shell, filesystem and search, background jobs, skills, goals, plan mode, context
  compaction, delegation and workflows, ask-user, todo, web, present) — nothing added,
  nothing removed.

The web declaration is [cordis.patch.yml](cordis.patch.yml). The roster, persona opening
and plan body are taken from the DeepSeek Harness standard preset, line-checked against
`@deepseek-ai/dsh-web-app/presets/standard.patch.yml` on the installed host; re-verify this
static composition when upgrading DSH.

## Boundaries

- The preset unlocks no tools and no permissions: approvals, sandbox, plan mode and the
  tool catalog stay under host control; the contract only governs answer content and
  scale.
- Against the upstream runtime plugin the behavioral gap is only: children with an
  explicit persona override do not carry the contract (a static preset cannot register a
  custom-named section to bypass the persona shadow); structured subagents miss one
  appended hint line on `tool:structured_output` (the contract's Runtime coordination
  bullet states the same principle); and there is no toggle, anchor check, prompt preview
  or recheck. `PTC_ONLY_NOTE` belongs to the ptc preset and has no object here.
- Uninstall by removing the `@klarkxy/dsh-unrestricted` bundle in the native plugin
  manager of the target profile.

## Verify

```sh
pnpm --filter @klarkxy/dsh-unrestricted test
pnpm check
```

Tests pin the contract fingerprint, roster parity with the standard preset, template
variables and packed contents. The [acceptance scenarios](ACCEPTANCE.md) evaluate real
model behavior; static keyword assertions do not stand in for them.

## Credits

Contract text adapted from yexi-by/dsh-unrestricted (MIT), itself derived from
Jia-Ethan/codex-keysmith (MIT); tool roster and plan body from DeepSeek Harness (MIT).
Full statements and license texts in [NOTICE.md](NOTICE.md).
