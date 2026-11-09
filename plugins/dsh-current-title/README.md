# Auto Title

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Keeps each DeepSeek Harness session title on the task you are working on; titles you rename by hand stay put.

```text
0903 | Fix | Login callback fails
```

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart it if DSH asks. Auto Title is enabled after installation and can be turned off in the plugin list.

## Use

Titles update automatically. Expand **Auto Title** under **Settings → Session Management** to:

- choose whether titles follow every message or only the first one;
- add your own title instruction;
- pick a title model (empty follows the default auxiliary model);
- regenerate the title of the open session.

With the optional **Model Picker** plugin installed, these model menus upgrade to the shared searchable picker with a reasoning-effort slider; without it they keep working as today.

When the title model is left empty the feature follows the **default auxiliary model**; with no default set it uses the current session model, then the host default chat model. The default auxiliary model is shared: set it once under **Settings → Session Management**, and every feature that follows it uses the same one.

When the model list fails to load or some providers are unavailable, use **Retry** beside the model picker; retrying keeps your saved model and prompt draft.

## Limits

- Each title costs one model call at the model's lowest supported reasoning effort; a failed generation keeps the existing title.
- Every call rebuilds its input from the session's current messages; earlier title answers are never fed back into later ones. If the shared default auxiliary model cannot be read, generation fails rather than using a model you did not choose.
- Cancellation and timeouts wait for the model call to stop; a provider that ignores cancellation can delay completion.
- Turning the plugin off hands titles back to the built-in DSH title feature.

## License

[SATA License 2.1](LICENSE)
