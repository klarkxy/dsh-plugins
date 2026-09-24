# Pruner / 删繁

[中文](README.zh-CN.md)

A native DeepSeek Harness preset for subtractive engineering: preserve supported behavior while removing unnecessary concepts, state, ownership and abstraction layers. It has its own system prompt and uses DSH's existing coding tools, skills, plan mode and compaction. There is no runtime plugin or automatic model router.

## Install

Requires Node.js 22.19+ and DSH 0.1.5-rc.2 with the standard coding tools. From this repository:

```sh
node plugins/dsh-pruner/install.mjs
# For an Editor or launcher with a separate Harness home:
node plugins/dsh-pruner/install.mjs --home "D:/my-dsh-home"
```

The installer copies the preset to `$DSH_HOME/.agent-presets/pruner`, falling back to `~/.dsh` when `DSH_HOME` is unset. Select **删繁 / Pruner** in a new session, then choose a strong reasoning model with a large context window and a supported high reasoning setting. The current preset metadata cannot bind a per-preset model or effort. Pruner leaves model selection to the session and does not modify global settings.

This is a native preset package, not a `dsh plugin add` bundle. Installation preserves other presets and settings and refuses an existing destination, including files and symlinks. Back up and move an existing `pruner` directory aside before updating. A failed copy reports an incomplete installation for inspection. Remove that preset directory to uninstall. Restart DSH and create a new session after editing installed assets; sessions with messages cannot switch presets. Hosts with `includeUserRoot: false` need to enable the user root or add it to their existing roster configuration without discarding other settings.

## Use

- **Audit:** “Find deletion and collapse candidates in this subsystem; do not modify anything.” Read-only analysis, with evidence and unresolved questions in the reply.
- **Execute:** “Simplify this module while preserving supported behavior, and verify the result.” Read-only MAP, then bounded ABLATE and COLLAPSE batches, verification and necessary fixes.

Audit is a prompt-level rule, not a separate tool-permission sandbox. Use the host's read-only permissions or plan mode when enforcement is required. Execute respects host permissions and plan mode.

Missing evidence makes something a candidate, not safe to delete. Trace dynamic consumers, public contracts, supported platforms, stored data and recovery before removal. Tests protecting obsolete implementation may go with it; user behavior and safety guarantees remain protected. Similar names do not prove identical ownership or temporal state semantics.

The report explains what disappeared, the consistent before/after counting scope, actual verification and remaining uncertainty. Zero removals can be correct. LOC and test counts are supporting evidence, not quotas.

The persona lives in [agent.cordis.yml](presets/pruner/agent.cordis.yml), with display metadata in [preset.yml](presets/pruner/preset.yml). Its static tool composition is adapted from DSH 0.1.5-rc.2; revalidate it when upgrading the host.

## Verify

```sh
pnpm --filter dsh-pruner test
pnpm check
```

Installer tests check real copies, collision refusal, existing settings and home selection. [Acceptance cases](ACCEPTANCE.md) assess model decisions separately; keyword tests cannot establish behavioral compliance. See `tasks/pruner.md` at the repository root for runtime evidence and outstanding checks.
