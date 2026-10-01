# Code Prune / 代码精简

Code Prune reviews and simplifies your code while preserving its current behavior: it cuts redundancy and needless abstraction, and reports what it removed and what it deliberately kept. It reuses the file, search, terminal, skill, plan-mode, and context-compaction tools DSH already ships with. The package name is `@klarkxy/dsh-pruner`.

[简体中文](README.zh-CN.md)

## Runtime requirements

Node.js 24+ and DSH 0.1.7-rc.2. The steps below use the `web` profile as the example.

## Install

Once published to npm, install it directly into the target profile:

```sh
dsh plugin --profile web add @klarkxy/dsh-pruner
```

Alternatively, pack the source and install the resulting `.tgz` into the target profile:

```sh
cd plugins/dsh-pruner
npm pack --ignore-scripts
dsh plugin --profile web add "D:/path/to/klarkxy-dsh-pruner-<version>.tgz"
```

Replace `web` with the name of a custom profile. Restart that profile, then pick **代码精简** in the preset selector of a new session. In the model picker, choose a currently available strong-reasoning model with a large context window and enable the higher reasoning effort that model supports.

## Two ways to ask

- **Audit** — “Audit this subsystem, find what could be deleted or merged, and change nothing yet.” The reply carries the evidence and the candidates; no report file, task file, or build cache is written.
- **Execute** — “Simplify this module while keeping currently supported behavior, and finish the verification.” Read-only MAP first, then bounded ABLATE and COLLAPSE batches, verification, and the fixes that verification calls for. Under an existing authorization it does not ask again for each reversible candidate.

## What makes something a deletion candidate

Missing evidence makes something a candidate — not something proven safe to delete. Before removing anything, it traces dynamic consumers, public contracts, supported platforms, stored data, and recovery paths. Tests that guard a now-obsolete implementation can go with it; user-visible behavior and safety guarantees stay protected. Having coverage does not by itself prove a design is necessary, and a failing test is not a reason to delete assertions. Similar names do not prove identical ownership or identical temporal state semantics: overlapping responsibilities can be merged, while a desired/observed pair with different temporal meaning, or a resource with its own lifetime, cannot be merged just because the names look alike.

## What the report covers

The report centers on what disappeared and compares concepts, states, and maintenance scope before and after under one consistent counting basis. It lists what was actually verified and what remains unverified. Zero removals can be the correct result; LOC and test counts are supporting evidence, not quotas.

## Boundaries and limits

- This bundle declares a native Preset and adds no runtime service. It leaves the global default preset, other presets, permissions, and model settings untouched.
- Audit is a model behavior rule, not a separate tool-permission sandbox. When you need enforcement, use the host's read-only permissions or plan mode as well. Host permissions and plan mode still bind: Execute does not lift them.
- A session that already has messages cannot switch presets — restart the profile and start a new session.
- The Web declaration is [cordis.patch.yml](cordis.patch.yml), migrated from [agent.cordis.yml](presets/pruner/agent.cordis.yml) and [preset.yml](presets/pruner/preset.yml). Its static tool composition is adapted from the standard Preset of DSH 0.1.5-rc.2 and was checked on Web 0.1.7-rc.2; revalidate that composition when you upgrade the host.
- DSH 0.1.7 no longer reads `$DSH_HOME/.agent-presets`, so `install.mjs` is kept only for legacy 0.1.5-rc.2 deployments and cannot install into the current Web. A `.agent-presets/pruner` directory left behind by the legacy installer is inert in 0.1.7; move it aside once you have confirmed the new bundle.
- To uninstall, remove the `@klarkxy/dsh-pruner` bundle from the target profile's native plugin manager.

## Verify

```sh
pnpm --filter @klarkxy/dsh-pruner test
pnpm check
```

The installer tests cover real copies, collision refusal, untouched existing settings, and home selection. [Acceptance cases](ACCEPTANCE.md) assess model decisions separately — static keyword assertions cannot stand in for behavioral acceptance. Runtime evidence and outstanding checks are recorded in `tasks/pruner.md` at the repository root.
