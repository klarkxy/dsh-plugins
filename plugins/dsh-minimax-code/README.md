# MiniMax Code for DSH

<!-- release-state-note -->

Use the official MiniMax Code login for image, video and speech generation, image search, transcription and audio/video understanding. No API key is entered in this plugin.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-minimax-code
```

Open and sign in to the official MiniMax Code desktop app. Enable this plugin in DSH, then open **Plugins → MiniMax Code**. Media calls use the app's official regional `mcode-tools` launcher; keep the app running. Leave the media path empty for discovery, or select the official launcher or JavaScript entry. Choose China or Global if both regional launchers exist.

Web search uses the separate official `mcode` CLI and a dedicated search configuration. Its executable path is independent of the media tools path. Availability checks do not generate media. Search must pass its tool and extension checks before a model request can start; the settings page reports its availability separately.

If the existing search profile enables MCP or executable extensions, select an independently signed-in official profile under **Search data directory**. The plugin does not alter global extensions or copy authentication files. Active extensions block search preflight without affecting media functions.

## Tools

| Tools | Purpose |
| --- | --- |
| `minimax_search` | Search public web pages and return source links |
| `minimax_generate_image` | Generate or edit images, up to 10 requests and 4 reference images per request |
| `minimax_search_images`, `minimax_reverse_image_search` | Find existing images, optionally download them, or search by an image |
| `minimax_generate_video`, `minimax_video_status` | Submit a video once, then query and download that same task |
| `minimax_list_voices` | List available voices |
| `minimax_synthesize_speech`, `minimax_batch_speech` | Generate one speech file or up to 10 independently parameterized files |
| `minimax_transcribe_audio` | Transcribe a recording |
| `minimax_understand_audio`, `minimax_understand_video` | Ask questions about up to 10 supplied files |
| `minimax_media_jobs`, `minimax_recover_media` | Find saved jobs and retrieve existing output without generating it again |

Image understanding, X search and music generation are not included.

## Files and video choices

Inputs must be explicit files inside the current workspace or attachments already present in the current session. The CLI uploads only the supplied media. Successful output is saved under `.dsh-minimax-code/<jobId>/` and returned as native DSH image/file attachments. Read-only workspaces cannot generate or download media.

Select a video model explicitly: H3 supports 4–15 seconds, 768P/2K and image/video/audio references; H3-Max supports 5–15 seconds, 480P/768P and text or keyframes; Hailuo 2.3 supports 6/10 seconds at 768P or 6 seconds at 1080P. H3 models can generate sound and use account credits; Hailuo is the lower-cost silent option available through the plan. Current account limits and vendor pricing still apply. No automatic model substitution occurs.

Video submission returns a `jobId`. Query it with `minimax_video_status`; do not submit the prompt again to check progress. If a download fails, use recovery. Cancellation stops the local CLI process tree but may not cancel a remote generation. Unknown submission outcomes stay marked uncertain, without automatic retries.

Job metadata is stored in the host's protected storage domain. Workspace receipt files cannot authorize access to arbitrary remote tasks. No login tokens, signed media links or prompts are stored in those job records.

See [acceptance evidence](ACCEPTANCE.md) for the tested versions and remaining limits.
