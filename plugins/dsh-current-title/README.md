# @klarkxy/dsh-current-title

Keeps a DSH session title on the task you are working on right now, and leaves a name you set by hand alone.

[简体中文](docs/README.zh-CN.md)

Migrated from [`dsh-plugins/dsh-current-title`](https://github.com/klarkxy/dsh-plugins/tree/main/plugins/dsh-current-title). Title type labels stay bilingual (`功能` / `Feature`, and the rest of the fixed vocabulary). Generation calls the host `llm` service directly, one call per title, with no retry.

The bundle insert is enabled after installation. It does not permanently turn off the built-in first-prompt title provider: this entry claims the native `sessionTitle` slot only while it is active, and disabling it restores that owner when this package still owns the slot and the displaced loader entry is unchanged. The plugin page holds an optional title instruction and an optional model. An empty instruction uses the built-in prompt; an empty model follows the live session model and then the host default chat model. The type label still follows the host language.

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. The **Auto Title** entry starts enabled and can be disabled in plugin settings. Native title storage and scheduling come from the host `sessionTitle`; generation uses the host `llm` service. Install the published package into the target profile:

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name. To uninstall, run `dsh plugin --profile web remove @klarkxy/dsh-current-title`.

Hosts that bundle this feature usually enable it by default; where the host supports live plugin switching, the switch under Settings → Plugins takes effect without a restart. Installation or removal may require a restart when the host asks for one.

## Host RPC

Channel `/dsh-current-title` requires the host authorization policy.

- `status` — current settings, slot support and ownership, and per-session title state (title, source kind, generating, pinned) when `sessionId` is given.
- `settings` — update the stored prompt and model with compare-and-swap (`{ prompt?, model?, expectedRevision }`). An empty prompt keeps the built-in instruction. An empty model follows the live session model and then the host default chat model. The type-label locale stays `auto`.
- `regenerate` — regenerate one session's title (`{ sessionId }`); fails with `not-found` for an unknown session and `unavailable` while the title provider is inactive.

## Title shape

```text
0903 | 修复 | 登录回调失败
```

Month and day, type label, task summary. The label comes from a fixed bilingual vocabulary, and the summary follows the language of the recent messages. Only recent real human `user/message` events feed a title; plugin auxiliary messages are ignored.

## Boundaries

- A manual rename is kept by native title storage.
- A failed generation writes no new title, so the session keeps the title it already has.
- Disabling cancels work in progress and drops late results.

## License

[SATA License 2.1](LICENSE), including attribution for the original `dsh-plugins` sources.
