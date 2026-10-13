# Grok Build for DSH

<!-- release-state-note -->
Lifecycle is tracked in the [repository registry](../../README.md#plugin-lifecycle): Draft → Testing → Published. See the [release guide](../../RELEASING.md).

Search the web, fetch pages, generate/edit images and create reference-based videos through the official local Grok Build CLI. The plugin reuses its existing login without reading or copying login tokens.

This package is private and under testing. It is not an npm release.

This adapter currently accepts the verified Grok Build 1.0.50 protocol only. New CLI versions require compatibility verification.

## Setup

For local development, run these commands from the monorepo root. Choose the DSH profile you intend to change; restart that profile afterward. Keep the checkout and its workspace dependencies available because this installs a local link.

```powershell
pnpm --filter @klarkxy/dsh-plugin-kit build
pnpm --filter @klarkxy/dsh-grok-build build
dsh plugin --profile web add "link:$(Resolve-Path plugins/dsh-grok-build)"
```

Install and sign in to the official Grok Build CLI, then enable this plugin in DSH. Open **Plugins → Grok Build** to check the connection and set an executable path if it is not on PATH. A connection check verifies the CLI and supported capabilities; it does not prove an authenticated model call. Sign in through Grok itself if a request reports a login failure.

Each call uses a fresh process and temporary configuration. The existing authentication path is passed to Grok; user model overrides, project instructions, external skills, plugins and MCP tools are excluded from that request. The CLI's built-in default model is used.

## Tools

| Capability | Purpose |
| --- | --- |
| Web search | Search public sources and return native citations |
| Page fetch | Retrieve the requested page using Grok's native fetch tool |
| Image generation | Generate an image from a prompt |
| Image editing | Edit supplied workspace images or current-session attachments |
| Image-to-video | Animate a supplied image |
| Reference-to-video | Generate video from images, preset voice IDs or keyframes |

Image understanding, X search, standalone audio generation and music are not included. Reference-to-video needs a reference; it is not a text-only video endpoint.

## Media file access

Enable **Allow native Grok tools to read media files** to use image editing and reference-based video. The plugin validates the supplied files and installs a per-request input guard. This is defense in depth, not a filesystem sandbox: the official CLI allows execution if its hook runner fails. These capabilities therefore run within the same local-file trust boundary as the official Grok CLI. The setting is off by default.

Inputs must be explicitly supplied workspace files or attachments already in the current DSH session. Media output is saved in the workspace and returned as native DSH image/file attachments. Read-only workspaces cannot generate media.

Cancellation stops the owned local process tree. It does not prove a remote generation was cancelled. Grok does not expose a remote video task ID before its native tool completes; interrupted submissions are marked uncertain and are never automatically repeated. Recovery reuses recorded local output rather than submitting a new generation.

See [acceptance evidence](ACCEPTANCE.md) for tested versions, native output evidence and remaining limits.
