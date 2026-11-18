# Zhihu

<!-- release-state-note -->

[简体中文](README.md) / English

Use Zhihu as a research source and draft assistant in DeepSeek Harness: site and web search, hot list, Zhida answers, knowledge bases, question discovery, creator stats, and draft saving/validation with image uploads. Every request uses your own Zhihu credentials, and retrieved items serve as reference material.

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
- Once configured, `zhihu_sync` lets the model save, list, read, and validate `article`, `question`, or `pin` drafts and upload images for them. Drafts persist across DSH restarts. This plugin covers draft preparation, validation, and image uploads; publishing is done on Zhihu.

## Agent Tools

These model tools are enabled by default in agent presets:

| Tool | Actions & Purpose |
| --- | --- |
| `zhihu_research` | One search: `search` (Zhihu), `global_search` (web, with optional `SearchDB` and structured `host` / `publishTime` filters), `hot_list`, `ask` (Zhida), `knowledge_search` |
| `zhihu_study` | Budgeted evidence for `deep`, `observation`, and `briefing`. The result is evidence, not a finished report |
| `zhihu_study_report` | Writes the host's synthesis to `report.md`, `report.json`, and a self-contained `report.html` the user can open |
| `zhihu_account` | Account & creator data: `question_recommendations` (question discovery), `question_answers` (answer summaries, not full text), `content_detail` (full text of your posts), `content_comments` (comments on your posts), `creator_account_stats` (account creator stats), `creator_content_stats` (per-post creator stats), `quota` (official daily free quota) |
| `zhihu_sync` | Drafts & media: `list` (list drafts), `get` (read draft), `save` (create/update draft), `prepare` (validate draft), `upload_image` (upload draft image) |

Site search and web search return an empty list when nothing matches, along with the upstream explanation when provided.

The routes `zhihu-deep-research`, `zhihu-observation`, and `zhihu-recent-briefing` load only when the host provides a skills service. Without it, that insert stays inactive and the two tools still register from the tools bundle.

## Deep research, Zhihu observation, and 30-day briefing

These three workflows are not separate official endpoints and not three prompts. The plugin combines the existing Zhihu search, web search, and optional knowledge-base search into a bounded evidence pass. The host writes the synthesis, then the plugin exports a local report. Zhida answers are not treated as original sources. The implementation is independent and does not include the official skill text, renderer, or layout.

### Entry

1. Call `zhihu_study`. Deep research searches Zhihu and the web; two or three sub-questions fit in the six-call cap, while four sub-questions plus both sources are rejected before any request. Observation searches both. A briefing freezes an Asia/Shanghai calendar window at collection time, covering the start day through that day, for up to 30 days. Web search uses the realtime index and a publication-time filter.
2. The result is evidence, not a finished report. Failure, exhausted budget, too few sources, and missing dates stay visible.
3. After synthesis, call `zhihu_study_report` with that same evidence. A sourced quantity must show its name, number, and adjacent unit in the quoted excerpt; otherwise mark it as an assumption. Dividing 20 square meters by 2 yuan yields 10 square meters per yuan. Read-only and unknown workspace modes cannot write files. A finished report means the structure checked out.
4. Open the returned `html`. The folder also contains `report.md` and `report.json`. The page loads nothing external and is not part of the settings UI.

### Input and output

`zhihu_study` takes `mode` and `question`, plus optional `queries`, `sources`, `maxCalls`, `windowDays`, and `since`. A knowledge base is searched only when `sources` includes `knowledge`. The result carries status, the call plan, failures, excerpts, limitations, and the host's synthesis constraints.

`zhihu_study_report` takes the synthesized `report`. Deep research may include interactive blocks. Observation needs at least two viewpoints tied to different sources. A briefing separates confirmed events, publication or update times, and undated items. Invalid input writes no files.

### Cost and boundaries

Every upstream request still checks that API's free quota and keeps the Beijing-day ledger, unknown-mapping rejection, explicit `allowPaid`, and no automatic retry. The study tools accept neither a paid switch nor credentials. One study cannot make more than six upstream searches or cover more than 30 days. When the call budget is omitted, the tool uses the plan size; a plan that does not fit is rejected before any request and cannot be extended by calling the tool again. The allowance is whatever the official quota call returns. Web filters accept structured site and publication-time fields only. The model tool and the shared search entry use those parameters; the settings page has no new filter controls.

Failure, exhausted budget, too few sources, missing dates, and cancellation each have their own status. They are not empty results. `empty` means the upstream call succeeded and returned nothing.

### Sampling, dates, and the host's job

Excerpts are not full text and not a complete sample. `HasMore: true` does not come with a public cursor. An observation sample must not be described as what all Zhihu users think. Author names and vote counts are kept only when the upstream payload actually includes them.

Web `AuthorityLevel` values `1` through `4` are labeled low, medium, high, and very high. Zhihu search keeps the raw `AuthorityLevel` and `RankingScore` only when they are present; those site values are not given the four-level labels, and missing scores are not invented.

Web `EditTime` is the last edit. Zhihu `EditTime` is a publication or update time. Neither is the time an event happened. A `publish_time` filter does not prove that either. Missing, unparseable, or conflicting item times stay out of the confirmed timeline. An event date must appear in a cited excerpt; otherwise it belongs with the undated items.

Every interactive number needs a source id or an explicit assumption. The plugin supplies no default airflow, price, or lifespan and does not evaluate an undeclared formula. The host writes conclusions, comparison, and impact. The exporter validates, escapes, and writes files. The automated tests cover those contracts, not the quality of a model's synthesis.

## Cost Protection

- By default, research and open-platform queries use only Zhihu's free allowance: before each request, the plugin checks the official quota for that API and sends the request only when free quota remains (with no extra local daily call limit).
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

## License

[SATA License 2.1](LICENSE)
