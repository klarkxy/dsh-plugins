# DSH ChatGPT

Give any DeepSeek Harness agent five directly registered tools: web search, image generation, image editing, vision, and bounded text analysis. Tool descriptions explain when to use them; users do not need to name a skill.

All requests run through the official local Codex app-server. The plugin never calls OpenAI HTTP endpoints, reads account tokens, or falls back to an API key. Codex owns authentication and token refresh.

## Local installation

This package is private while local acceptance is in progress and is not published on npm.

```powershell
pnpm --filter @klarkxy/dsh-chatgpt build
dsh plugin --profile web add "link:H:/Code/dsh-plugins/plugins/dsh-chatgpt"
dsh web
```

Open the plugin's configuration page and click Refresh status. An existing Codex ChatGPT sign-in is reused. Otherwise choose browser or device-code sign-in; use device codes when the browser and DSH run on different machines.

Codex `0.162.0-alpha.17.2` or newer must be installed on the machine running DSH. Set an explicit executable path if discovery fails. Leave the model empty to use the runtime's default, or select a model and reasoning effort. Saving plugin settings does not change global Codex configuration.

## Tools

| Tool | Purpose |
| --- | --- |
| `chatgpt_search` | Current public-web research with source links |
| `chatgpt_generate_image` | Generate a real image, optionally with references |
| `chatgpt_edit_image` | Edit explicitly selected images while preserving originals |
| `chatgpt_view_image` | Read screenshots, inspect or compare images |
| `chatgpt_ask` | Analyze, reason about, translate, or write supplied text |

Image inputs are workspace files or image attachment IDs already present in the calling session, up to five per call. Generated images are saved under `.dsh-chatgpt/` in that workspace and returned as session attachments. Generation and editing require workspace write permission.

Each request has its own Codex thread. Environment tools are disabled. Search success requires native search evidence; image success requires a completed native image event and its actual attributed raster file. Unsupported capabilities fail explicitly.

Cancellation and plugin unload terminate only plugin-owned processes. Login cancellation applies only to a login started by this plugin; there is no shared-account logout action. Calls consume the signed-in account's Codex allowance. Connection status does not prove model or tool entitlement.

The plugin requires experimental app-server environment-isolation fields. Incompatible Codex runtimes fail explicitly. Target DSH compatibility is declared in `engines.dsh`; live acceptance evidence is recorded in `ACCEPTANCE.md`.

## Development

```powershell
pnpm --filter @klarkxy/dsh-chatgpt typecheck
pnpm --filter @klarkxy/dsh-chatgpt test
pnpm --filter @klarkxy/dsh-chatgpt build
node --test scripts/plugin-settings.test.mjs
pnpm test:editor-build
```

Official references: [app-server](https://learn.chatgpt.com/docs/app-server), [web search](https://learn.chatgpt.com/docs/web-search), [image generation and editing](https://learn.chatgpt.com/docs/image-generation).
