# DSH ChatGPT

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Give any DeepSeek Harness agent ChatGPT web search, image generation, image editing, and image understanding, using the Codex app already signed in on your computer. No API key is needed.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-chatgpt
```

You also need the official Codex, version `0.162.0-alpha.17.2` or later, on the same computer as DSH. Open the plugin page and click **Refresh status**. An existing Codex ChatGPT sign-in is reused; otherwise sign in with the browser or a device code (use the device code for a remote DSH). If Codex is not found, enter its path. Calls use the Codex default model. The plugin keeps sign-in, executable path, and timeout settings; it does not provide a text-chat tool or a model selector.

## Tools

| Tool | Use it to |
| --- | --- |
| `chatgpt_search` | Look up current information with source links |
| `chatgpt_generate_image` | Create images, optionally from reference images |
| `chatgpt_edit_image` | Edit a chosen image; the original is kept |
| `chatgpt_view_image` | Describe images, read text in screenshots, compare images |
| `chatgpt_media_jobs`, `chatgpt_recover_media` | Find saved media jobs and recover their images without generating again |

The agent picks these tools on its own; you do not need to name them.

When DSH web access is enabled, ChatGPT also appears as a search provider. With Web Search Manager installed, enable and order **ChatGPT (Codex)** alongside other providers in its settings. Sign-in, executable path and timeout remain in this plugin's settings. The standalone tools remain available without Web Search Manager.

## Limits

- Calls use your ChatGPT account's Codex allowance.
- Provider availability checks only the local Codex installation; each search still verifies ChatGPT sign-in. Refresh availability by saving the plugin settings after installing or moving Codex.
- Only search is offered to DSH web access. Codex does not expose a verified raw-page retrieval result with an HTTP status code, so it is not a page-fetch provider.
- Images come from workspace files or images already in the session, up to five per call. Results are saved under `.dsh-chatgpt/` in the workspace, so creating or editing images needs write access.
- Cancelled or failed media delivery keeps a workspace job ID. Use recovery to retrieve saved images; remote generation may continue, and recovery never submits generation again.
- Older Codex versions are refused with a compatibility error.

## License

[SATA License 2.1](LICENSE)
