# Pruner / 删繁

[中文](README.zh-CN.md)

A native DeepSeek Harness preset for subtractive engineering: preserve supported behavior while removing unnecessary concepts, state, ownership and abstraction layers. It has its own system prompt and uses DSH's existing coding tools, skills, plan mode and compaction. There is no runtime plugin or automatic model router.

## Install

The Web bundle requires Node.js 24+ and DSH 0.1.7-rc.2. Once published to npm, install it directly:

```sh
dsh plugin --profile web add @klarkxy/dsh-pruner
```

Alternatively, pack the source and install the resulting `.tgz` into the target profile:

```sh
cd plugins/dsh-pruner
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-pruner-0.2.0.tgz"
```

Replace `web` for a custom profile. Restart the profile and select **删繁 / Pruner** in a new session, then choose a strong reasoning model with a large context window and a supported high reasoning setting. Preset metadata cannot bind a model or effort. Pruner leaves model selection to the session and does not modify global settings. DSH 0.1.7 no longer reads `$DSH_HOME/.agent-presets`; `install.mjs` is retained only for legacy 0.1.5-rc.2 deployments.

This bundle declares a native Preset without a runtime service. It preserves other presets, permissions, and model settings. Existing sessions with messages cannot switch presets. Uninstall the `@klarkxy/dsh-pruner` bundle from the target profile's native plugin manager. A legacy `.agent-presets/pruner` directory is inert in 0.1.7 and can be removed after confirming the new bundle.

## Use

- **Audit:** “Find deletion and collapse candidates in this subsystem; do not modify anything.” Read-only analysis, with evidence and unresolved questions in the reply.
- **Execute:** “Simplify this module while preserving supported behavior, and verify the result.” Read-only MAP, then bounded ABLATE and COLLAPSE batches, verification and necessary fixes.

Audit is a prompt-level rule, not a separate tool-permission sandbox. Use the host's read-only permissions or plan mode when enforcement is required. Execute respects host permissions and plan mode.

Missing evidence makes something a candidate, not safe to delete. Trace dynamic consumers, public contracts, supported platforms, stored data and recovery before removal. Tests protecting obsolete implementation may go with it; user behavior and safety guarantees remain protected. Similar names do not prove identical ownership or temporal state semantics.

The report explains what disappeared, the consistent before/after counting scope, actual verification and remaining uncertainty. Zero removals can be correct. LOC and test counts are supporting evidence, not quotas.

The Web declaration is [cordis.patch.yml](cordis.patch.yml), migrated from [agent.cordis.yml](presets/pruner/agent.cordis.yml) and [preset.yml](presets/pruner/preset.yml). Its static tool composition is adapted from DSH 0.1.5-rc.2 and checked on Web 0.1.7-rc.2; revalidate it when upgrading the host.

## Verify

```sh
pnpm --filter @klarkxy/dsh-pruner test
pnpm check
```

Installer tests check real copies, collision refusal, existing settings and home selection. [Acceptance cases](ACCEPTANCE.md) assess model decisions separately; keyword tests cannot establish behavioral compliance. See `tasks/pruner.md` at the repository root for runtime evidence and outstanding checks.
