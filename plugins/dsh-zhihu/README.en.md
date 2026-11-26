# Zhihu

<!-- release-state-note -->

[简体中文](README.md) / English

Use Zhihu as a research source and draft assistant in DeepSeek Harness: site and web search, hot list, Zhida answers, knowledge bases, question discovery, creator stats, and draft saving/validation with image uploads. Every request uses your own Zhihu credentials, and retrieved items serve as reference material.

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-zhihu.svg)](https://www.npmjs.com/package/@klarkxy/dsh-zhihu)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Replace `web` with your profile name and restart DSH Web. Always specify the full scoped package name `@klarkxy/dsh-zhihu`, as the unscoped `dsh-zhihu` package is maintained by another author.

## Usage

Open **Settings → Zhihu**, which provides five tabs:

- **Settings**: configure the `Access Secret` for research and account queries, configure the publisher `App Key` and `App Secret` for draft sync and image uploads, and check the current call-protection status.
- **Stats**: view local daily call counts, failures, and returned result counts.
- **Official quota**: query the remaining free allowance reported by Zhihu Open Platform.
- **Knowledge base**: browse Zhihu knowledge bases and upload reference files (up to 20 MB per file) for retrieval; uploaded files go to Zhihu cloud, so avoid unpublished manuscripts.
- **Test**: manually test site search, web search, hot list, knowledge-base search, Zhida direct answers (with expandable reasoning), and open-platform queries (question recommendations, answer summaries, your content detail/comments, and creator stats), and inspect or copy structured JSON responses.

With the Web Search plugin (`@klarkxy/dsh-web-search-manager`) installed, Zhihu Web Search also appears in its provider list.

## Drafts and Media

- In **Settings → Zhihu → Settings**, configure the publisher credentials obtained from the [Zhihu publishing assistant](https://www.zhihu.com/playground/zhihu-publisher). These are separate from the search `Access Secret`.
- You can paste Zhihu's full authorization text directly into the **App Secret** field when both `ZHIHU_OPENAPI_APP_KEY:"…"` and `ZHIHU_OPENAPI_APP_SECRET:"…"` are present; the plugin extracts and keeps only those two values (and offers a **Save both** action).
- Once configured, `zhihu_sync` lets the model save, list, read, and validate `article`, `question`, or `pin` drafts and upload images for them. Drafts persist across DSH restarts. Drafts are stored locally in DSH. The plugin prepares and validates drafts and uploads images, but does not publish. To publish, paste the content into the Zhihu editor or use the official Zhihu publishing assistant.

## Agent Tools

These model tools are enabled by default in agent presets:

| Tool | Actions & Purpose |
| --- | --- |
| `zhihu_research` | One search: `search` (Zhihu), `global_search` (web, with optional `SearchDB` and structured `host` / `publishTime` filters), `hot_list`, `ask` (Zhida), `knowledge_search` |
| `zhihu_study` | Budgeted evidence for `deep`, `observation`, and `briefing`. The result is evidence, not a finished report |
| `zhihu_study_report` | Writes the host's synthesis to `report.md`, `report.json`, and a self-contained `report.html` the user can open |
| `zhihu_account` | Account & creator data: `question_recommendations` (question discovery), `question_answers` (answer summaries, not full text), `content_detail` (full text of your posts), `content_comments` (comments on your posts), `creator_account_stats` (account creator stats), `creator_content_stats` (per-post creator stats), `user_contents` (your posts), `user_followees` (accounts you follow), `user_collections` (recent collections), `user_favlists` (favlists), `favlist_contents` (favlist contents), `quota` (official daily free quota) |
| `zhihu_sync` | Drafts & media: `list` (list drafts), `get` (read draft), `save` (create/update draft), `prepare` (validate draft), `upload_image` (upload draft image) |

Site search and web search return an empty list when nothing matches, along with the upstream explanation when provided.

The routes `zhihu-deep-research`, `zhihu-observation`, and `zhihu-recent-briefing` load only when the host provides a skills service. Without it, that insert stays inactive and the two tools still register from the tools bundle.

## Deep research, Zhihu observation, and 30-day briefing

These modes are not separate official endpoints. They are bounded evidence passes: `deep` searches Zhihu and the web by sub-question, `observation` samples viewpoints and also reads answer summaries under up to 2 matched questions by default, and `briefing` collects recent items in a fixed calendar window.

How to use them:

1. Call `zhihu_study` to receive evidence with status, excerpts, and limitations; this is not a finished report.
2. Let the model synthesize that evidence, then call `zhihu_study_report`.
3. Open the generated `report.html`; `report.md` and `report.json` are written next to it.

Main limits:

- Excerpts and answer summaries are not full text; one sample is not Zhihu user consensus.
- One study makes at most 6 upstream requests and cannot be extended through repeated calls.
- A briefing window is at most 30 days. Item times are publication or edit times, not event times.
- Export requires a writable workspace; invalid input writes no files.
- Official free-quota protection applies. Requests are not retried, and the study input cannot carry credentials or a paid switch.

## Cost Protection

- By default, research and open-platform queries use only Zhihu's free allowance: while plenty remains, the official quota for each API is re-checked at most every 5 minutes; when allowance is low or uncertain, it is checked before every request, and the request is sent only when free quota remains (with no extra local daily call limit).
- Identical search, web-search, hot-list, and question-answer results are reused briefly; cache hits do not spend free allowance. A protection lock left behind by a crashed process recovers automatically.
- Paid calls are disabled by default and require explicit opt-in via `allowPaid: true` in plugin config (or via environment variable):

```yaml
config:
  allowPaid: false
```

Capabilities without confirmed upstream pricing remain restricted to verified free allowance even if `allowPaid` is enabled.

## Limitations

- Other clients sharing the same Zhihu account can consume the free allowance between quota checks; local counts are not billing.
- Knowledge-base uploads are stored on Zhihu cloud and capped at 20 MB per file via the settings UI; draft images are also uploaded to Zhihu.
- Drafts support articles, questions, and pins only. Supported image formats are JPEG, PNG, GIF, WebP, and BMP (up to 15 MB for GIF, and up to 30 MB for other formats; transcoding is not built in, so convert HEIC/AVIF beforehand).
- Draft and image operations use publishing credentials, separate from search quota and `allowPaid` settings; the tool can save, validate, and upload images, but cannot publish directly.
- Each request runs once without automatic retries.
- Requests use the configured `Access Secret` only; OAuth account switching, top-ups, wallet queries, and publishing drafts stay on Zhihu.
- Always specify the full scoped package name `@klarkxy/dsh-zhihu`; the unscoped `dsh-zhihu` package is maintained by another author.

## License

[SATA License 2.1](LICENSE)
