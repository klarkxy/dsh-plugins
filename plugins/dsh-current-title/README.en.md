# Auto Title

<!-- release-state-note -->

[简体中文](README.md) / English

Keeps each DeepSeek Harness session title aligned with the task you are working on, while leaving titles you rename by hand untouched.

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-current-title.svg)](https://www.npmjs.com/package/@klarkxy/dsh-current-title)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart the profile if DSH prompts you. Auto Title is enabled after installation and can be turned off in the plugin list.

## Usage

Session titles update automatically as your task evolves, formatted as `MMDD | Type | Summary`:

```text
0903 | Fix | Login callback fails
```

Expand **Settings → Session Management → Auto Title** to inspect or adjust:

- **Current session**: view the current title (manual renames are marked **Renamed manually**), click **Regenerate** to refresh the open session's title, or **Reload (discard draft)** to refetch settings. When the title slot is inactive, a status note and **Retry** button appear.
- **Title prompt**: add custom title instructions (saves when the field loses focus). Leaving it empty uses the built-in instruction while still returning a type and summary.
- **Title model**: choose a dedicated model or follow **Default auxiliary model**. If loading the model list fails or some providers are unavailable, click **Retry** beside the picker without losing your saved model or prompt draft.
- **Update cadence**: choose **Track the current task (every message)** or **First message only**.

When **Title model** is left on **Default auxiliary model** and no global default is set, it falls back to the current session model and then the host default chat model. The global **Default auxiliary model** under **Settings → Session Management** is shared across every feature that follows it. With the optional **Model Picker** plugin installed, model menus upgrade to the shared searchable picker with a reasoning-effort slider; without it, the built-in menu continues to work.

## Limitations

- Each title generation makes one model call using that model's lowest supported reasoning effort; if generation fails, the existing title is kept.
- Every call rebuilds input from the session's current messages and never feeds earlier title outputs back in; delegated subagent sessions are skipped and keep the host fallback title.
- If the shared default auxiliary model cannot be read while following it, generation fails rather than falling back to a model you did not select.
- Cancellation and timeouts wait for the underlying model call to stop; a provider that ignores cancellation can delay completion.
- Turning off or uninstalling the plugin hands titling back to DSH's built-in title provider.

## License

[SATA License 2.1](LICENSE)
