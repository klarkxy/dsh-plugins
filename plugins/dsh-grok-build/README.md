# Grok Build

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Use the Grok Build CLI already signed in on your computer to search the web, read pages, create and edit images, and make videos from images.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-grok-build
```

Also install and sign in to the official Grok Build CLI. Only version 1.0.50 is supported for now. Open **Plugins → Grok Build**; if the CLI is not on PATH, enter its path.

## Tools

| Tool | Use it to |
| --- | --- |
| `grok_search` | Search the web with source links |
| `grok_fetch` | Read a page |
| `grok_generate_image` | Create images |
| `grok_edit_image` | Edit a workspace image or session attachment |
| `grok_image_to_video` | Animate an image |
| `grok_reference_to_video` | Make a video from reference images, a voice preset, or keyframes |
| `grok_media_jobs`, `grok_recover_media` | Find earlier results and fetch them again |

## Limits

- Image editing and video need **Allow Grok native tools to read media files** (off by default). This is an extra check, not a sandbox: Grok can read files as your local CLI normally can.
- Results are saved in the workspace, so a read-only workspace cannot create media.
- Cancelling stops the local process but may not stop generation on Grok's side; nothing is regenerated automatically.
- Not included: image understanding, X search, audio, or music.

## License

[SATA License 2.1](LICENSE)
