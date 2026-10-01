# @klarkxy/dsh-recap

Writes session recaps in the background and gives the agent bounded progress checkpoints: after a long turn, or when you come back later, the session gets a short recap to read, and the model gets a length-capped progress note at key points. The plugin starts enabled and can be switched off under Settings → Plugins; recaps, agent checkpoints, and semantic checkpoints use fixed automatic defaults.

[简体中文](docs/README.zh-CN.md)

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. Auxiliary generation calls the host `llm` service directly. `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-session` are required peers.

```sh
dsh plugin --profile web add @klarkxy/dsh-recap
```

Replace `web` with your profile name; to uninstall, run `dsh plugin --profile web remove @klarkxy/dsh-recap`.

## Recaps

Recaps appear on the chat events seat — a quiet lifecycle controller that renders nothing until the session has a stored recap, then shows the recap cards with Generate, Cancel, and Regenerate (regenerating a finished recap asks for a second click).

A recap is written in the background after a long turn ends, or when you come back after the idle interval. The interval defaults to 15 minutes of focused document and user activity: assistant streaming does not count, and neither does time spent while the chat panel is `hidden`.

Reading status never calls the model. Each watermark gets at most one generation, unless you retry that card or request a manual `refresh`.

## Checkpoints

Checkpoints are injected only at host `agent/pre-step`, and only on meaningful boundaries, using native `createUserMessage`. The injected snapshot is bounded — it lists at most 12 items and is truncated to 2000 characters — so a long turn cannot flood the model with context.

Checkpoint items are collected from the session log. With semantic checkpoints on, a model only refines the checkpoint's next step. When Mood is active in the same profile, Recap reads its task contract through `ctx.aiMood.getContract(sessionId)` for checkpoint context.

## Plugin page settings

`Settings → Plugins → Task Recap` has switches for recap cards, task checkpoints, and semantic checkpoints, the away interval in minutes (1–180), and one model row per feature: **Recap card model** for recap cards and **Semantic checkpoint model** for semantic checkpoints. Both are optional. A saved route is used for that feature's own call as an explicit model; an empty selection follows the live session model and then the host default chat model.

The same switches can also be changed through the `update` RPC. Turning an ability off cancels in-flight generation and stops auto injection; stored recaps remain. Unloading the plugin waits for pending writes and ignores later session events.

## Boundaries

- Recaps are display-only and are not model context; checkpoints are the only thing injected into the model.
- Semantic checkpoints only run while task checkpoints are on.
- A saved route affects only these two features, and it selects a model — it is not evidence of connectivity.

## Host RPC

Channel `/dsh-recap` requires the host authorization policy.

- `status` — settings, storage health, and stored cards and checkpoints (optionally for one `sessionId`). Never calls the model.
- `update` — write settings (`cardsEnabled`, `checkpointsEnabled`, `semanticCheckpointsEnabled`, `idleReturnMs`) with compare-and-swap (`expectedRevision`).
- `cards` / `checkpoints` — the stored recap cards or checkpoints, optionally for one session.
- `cancel` / `retry` — cancel a card's in-flight generation, or regenerate that card (`{ cardId, sessionId }`).
- `idle.return` — run the idle-return check for a session immediately.
- `refresh` — generate a recap for a session on demand (`manual` trigger), independent of the one-generation-per-watermark rule.

## Development

From the repository root:

```sh
pnpm --filter @klarkxy/dsh-recap typecheck
pnpm exec vitest run packages/dsh-recap/src
pnpm --filter @klarkxy/dsh-recap build
```

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, toggling needs no restart. Installation or removal may require a restart when the host asks for one.
