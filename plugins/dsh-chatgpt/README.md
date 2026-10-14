# DSH ChatGPT

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Give any DeepSeek Harness agent ChatGPT web search, image generation, image editing, image understanding, and text analysis, using the Codex app already signed in on your computer. No API key is needed.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-chatgpt
```

You also need the official Codex, version `0.162.0-alpha.17.2` or later, on the same computer as DSH. Open the plugin page and click **Refresh status**. An existing Codex ChatGPT sign-in is reused; otherwise sign in with the browser or a device code (use the device code for a remote DSH). If Codex is not found, enter its path. You can also pick the model and reasoning effort there.

## Tools

| Tool | Use it to |
| --- | --- |
| `chatgpt_search` | Look up current information with source links |
| `chatgpt_generate_image` | Create images, optionally from reference images |
| `chatgpt_edit_image` | Edit a chosen image; the original is kept |
| `chatgpt_view_image` | Describe images, read text in screenshots, compare images |
| `chatgpt_ask` | Analyze, translate, or write about text you provide |

The agent picks these tools on its own; you do not need to name them.

## Limits

- Calls use your ChatGPT account's Codex allowance.
- Images come from workspace files or images already in the session, up to five per call. Results are saved under `.dsh-chatgpt/` in the workspace, so creating or editing images needs write access.
- Older Codex versions are refused with a compatibility error.

## License

[SATA License 2.1](LICENSE)
