# Auto Title

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Keeps each DeepSeek Harness session title on the task you are working on. A title you rename by hand is never overwritten.

```text
0903 | Fix | Login callback fails
```

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

Replace `web` with your profile name and restart it if DSH asks. Auto Title is enabled after installation and can be turned off in the plugin list.

## Use

Titles update automatically. Under **Plugins → Auto Title** you can:

- choose whether titles follow every message or only the first one;
- add your own title instruction;
- pick a title model (empty follows the current session model);
- regenerate the title of the open session.

If the model list cannot load, or some providers fail, use **Retry** beside the model picker. Retrying keeps your saved model and prompt draft.

## Limits

- Each title costs one model call; failed generations keep the existing title.
- Turning the plugin off hands titles back to the built-in DSH title feature.

## License

[SATA License 2.1](LICENSE)
