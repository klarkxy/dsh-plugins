# Delegation Mode

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

A per-session switch that has the main agent plan, delegate to subagents, and review results while subagents carry out the work. When on, the main agent acts as a coordinator — breaking the request into tasks, handing them to subagents, and checking their reports — while subagent sessions receive matching guidance to complete the assigned work.

## Install

```bash
dsh plugin --profile web add @klarkxy/dsh-delegation
```

Enable the plugin in your profile, then reload the page or restart the profile as the manager requires.

## Use

- On the new-session page, use the switch on the same row as the workspace and preset selectors before sending the first message: **Default** is gray; **Delegate** uses the theme color. The choice locks once the session starts, including after reopening it. The switch applies to the session's main agent, and its subagents automatically receive matching execution guidance.
- In **Plugins → Delegation Mode**, **Enable Delegation Mode for new sessions** sets the initial state for sessions created later.
- Simple tasks can be completed directly. For larger tasks, the main agent assigns scoped work to subagents, coordinates shared interfaces, and checks their results before reporting completion.

## Limits

- Presets that expose subagent tools — Standard and PTC — support delegation; presets without subagent tools (such as Minimal and other complete-persona presets) keep the switch disabled.
- The switch updates prompt guidance only; tool access and permissions remain unchanged, and delegation is guided rather than strictly enforced.
- Delegation Mode stays fixed once a session starts, keeping the session's prompt cache stable.
- Changing the default applies to sessions created afterwards; existing sessions keep their current state.
- The added prompt section may reduce provider prompt-cache hits.

## License

[SATA License 2.1](LICENSE)
