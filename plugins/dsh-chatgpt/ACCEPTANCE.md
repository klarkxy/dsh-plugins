# Local acceptance — 2026-10-10

Candidate: private `@klarkxy/dsh-chatgpt@0.1.0-alpha.1`. No npm publication, repository commit, or modification of the user's normal DSH profile was performed.

## Observed environment

- Windows, Node 26.10.0.
- DSH Web 0.2.1-alpha.2 in a fresh isolated `DSH_HOME`, using the actual official host services and browser UI.
- Official local Codex Desktop runtime 0.162.0-alpha.17.2, existing ChatGPT-managed sign-in, runtime default model GPT-6.1-Sol.
- Requests used Codex app-server stdio. The plugin made no direct OpenAI HTTP requests and used no API-key fallback.

## Live results

| Check | Evidence |
| --- | --- |
| Text | Returned the exact requested `DSH-CHATGPT-TEXT-OK` marker. |
| Search | Two native `webSearch` completed items and official documentation source URLs. |
| Image generation | Native completed `imageGeneration`, attributed saved PNG, visually inspected blue teapot. |
| Image editing | Native completed `imageGeneration`, separate red teapot PNG; original retained and visually inspected. |
| Vision | Correctly described the blue teapot and cream background. |
| DSH registry | Actual `ctx.tools.schemas()` exposed all five tools and natural task descriptions without skill activation. |
| DSH tool execution | `ctx.tools.execute()` generated a 1254 × 1254 PNG, returned its workspace path and a SHA-256 image attachment; another execution correctly identified the edited teapot as red. |
| Settings UI | Actual plugin configuration slot mounted; existing sign-in, runtime version and model catalog displayed. Desktop and 390 px mobile screenshots inspected. |
| Inherited MCP | An enabled test server appeared in effective config; thread override disabled it. Native text call succeeded and server startup marker was never created. No global configuration file was edited. |
| Cancellation/unload | Cancelled a real invocation; both owned Codex PIDs terminated, request directories removed, workspace entry list unchanged. |

The tools' native evidence requirements also correctly rejected the earlier configuration that hid search/image tools. Newer models force code-mode-only; direct namespace exposure fixes this while the process-level code execution provider remains disabled.

## Automated checks

- Plugin tests: 52 passing, including protocol correlation, auth ownership, MCP suppression, image attribution, input confinement, publication cancellation, settings concurrency and UI lifecycle.
- Plugin typecheck and Node/browser build passed.
- Required settings registration check passed; editor build contract suite passed (17 tests).
- Independent read-only review passed, including the final native namespace and transport-discriminator changes.

## Verification limits

Fresh browser/device sign-in completion was not exercised because an existing sign-in was available. Its protocol and cancellation paths have mocked tests. The isolated host had no DSH main-model credentials, so natural-language autonomous tool selection by a DSH main agent was not measured; direct schema visibility and real host dispatch were measured. Current-session attachment authorization is covered by event-shape and ownership regressions; the live vision check used a workspace file. The user's installed Desktop profile, other operating systems, older Codex versions and sustained multi-day operation were not tested.

The declared target is DSH >=0.2.0-rc.2; the historical Web acceptance above used 0.2.1-alpha.2 and does not establish Desktop activation. This alpha requires experimental Codex isolation fields and reports incompatible runtimes explicitly. The plugin remains private and is delivered as a local installable package.
