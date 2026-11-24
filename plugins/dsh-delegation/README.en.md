# Delegation Mode

<!-- release-state-note -->

[简体中文](README.md) / English

A per-session switch where the main agent plans, delegates to subagents, and reviews results, while subagent sessions automatically receive matching execution guidance.

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-delegation.svg)](https://www.npmjs.com/package/@klarkxy/dsh-delegation)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-delegation
```

Replace `web` with your profile name, enable the plugin in the profile, and reload the page or restart the profile as the plugin manager asks.

## Usage

1. On the new-session page, find the **Delegate** chip on the same row as the workspace and preset selectors.
2. Toggle it before sending the first message; when enabled, the chip highlights in the theme color.
3. The choice locks once the session starts and stays fixed when you reopen the session; existing sessions keep their current state.

Behavior details:

- **Remembered choice**: the chip remembers your latest successful toggle on the new-session page and applies it to subsequent new sessions (including after restarts). If no choice has been remembered yet, new sessions use any previously saved global default.
- **Fork inheritance**: a session forked from an existing one inherits its parent's delegation state without changing the remembered choice for new sessions.
- **Coordinator & executor flow**: when on, the main agent may still answer simple tasks directly, while larger or multi-part tasks are scoped, delegated to subagents, and verified before reporting; spawned subagents automatically receive executor guidance.
- **Combined entry**: install `@klarkxy/dsh-model-hub` for a combined entry to subagent model configuration and Delegation Mode; this package remains available as a standalone compatibility option.

## Limitations

- Only presets that expose subagent tools (such as Standard and PTC) support Delegation Mode; presets without subagent tools (such as Minimal and other complete-persona presets) keep the **Delegate** chip disabled.
- The plugin updates prompt guidance only; tool catalogs, approvals, and permissions remain unchanged, and delegation is guided rather than strictly enforced.
- Delegation Mode locks once a session starts to keep its prompt cache stable; the added prompt section may reduce provider prompt-cache hits compared with sessions where it is off.

## License

[SATA License 2.1](LICENSE)
