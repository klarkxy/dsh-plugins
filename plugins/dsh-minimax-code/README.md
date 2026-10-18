# MiniMax Code

<!-- release-state-note -->

[简体中文](README.zh-CN.md)

Use the MiniMax Code app already signed in on your computer to search the web, create images, video, and speech, search images, transcribe audio, and understand audio and video. No API key is needed.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-minimax-code
```

Start and sign in to the official MiniMax Code desktop app, then open **Plugins → MiniMax Code**. Tool paths are found automatically; if both China and global versions are installed, choose one. Keep MiniMax Code running while you use the media tools.

## Tools

| Tool | Use it to |
| --- | --- |
| `minimax_search` | Search the web with source links |
| `minimax_generate_image` | Create or edit images from references |
| `minimax_search_images`, `minimax_reverse_image_search` | Find existing images, or search by image |
| `minimax_generate_video`, `minimax_video_status` | Start a video and check or download it later |
| `minimax_list_voices`, `minimax_synthesize_speech`, `minimax_batch_speech` | List voices and create speech |
| `minimax_transcribe_audio` | Transcribe recordings |
| `minimax_understand_audio`, `minimax_understand_video` | Ask questions about audio or video |
| `minimax_media_jobs`, `minimax_recover_media` | Find earlier results and fetch them again |

When the host provides web search, choose **MiniMax Code** as its provider in the web settings. The dedicated `minimax_search` tool remains available. Search uses the official mcode CLI signed in to a profile without executable extensions; configure its path and search profile in this plugin. Local CLI discovery indicates availability, while sign-in and compatibility are checked when a request runs. Calls may use your account's model and tool allowance. Page retrieval is not integrated; the verified search connection does not expose it.

## Limits

- Video requires choosing a model. H3 models can add sound and use account credits; Hailuo 2.3 is a cheaper silent option. Actual costs follow your MiniMax account.
- Check video progress with `minimax_video_status` instead of submitting again.
- Inputs must be workspace files or session attachments. Results are saved under `.dsh-minimax-code/`, so a read-only workspace cannot create media.
- Cancelling stops the local process but may not stop generation on MiniMax's side. Find the job in the same workspace; status and recovery never resubmit generation.
- Not included: image understanding, X search, or music.

## License

[SATA License 2.1](LICENSE)
