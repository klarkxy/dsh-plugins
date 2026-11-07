# Zhihu

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Use Zhihu as a research source for the model: site search, web search, hot list, Zhida answers, knowledge bases, question discovery, and creator statistics. The `zhihu_sync` tool also saves and validates article, question, or pin drafts and uploads images. Every request uses your own Zhihu Access Secret, and returned items serve as reference material.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Replace `web` with your profile name and restart DSH Web. Always specify the full scoped name `@klarkxy/dsh-zhihu`, as the unscoped `dsh-zhihu` is a separate package by another author.

## Use

Open **Settings → Zhihu** and enter your Access Secret under **Settings**. Other tabs:

- **Stats**: local daily calls, failures, and result counts;
- **Official quota**: remaining free allowance as reported by Zhihu;
- **Knowledge base**: upload and search reference files;
- **Test**: run any search or query by hand, expand an answer's reasoning, and inspect or copy structured response data.

With the Web Search plugin installed, Zhihu web search also appears in its provider list.

## Drafts and media

In **Settings → Zhihu → Settings**, configure the publishing App Key and App Secret obtained from the [Zhihu publishing assistant](https://www.zhihu.com/playground/zhihu-publisher). These are separate from the search Access Secret. You can also paste Zhihu’s authorization text directly into the App Secret field when both credentials appear as `ZHIHU_OPENAPI_APP_KEY:"…"` and `ZHIHU_OPENAPI_APP_SECRET:"…"`; the plugin extracts and keeps those two values only. The `zhihu_sync` tool then lets the model save, list, read, and validate drafts for articles, questions, or pins, and upload images for them. Drafts persist across DSH restarts. This plugin covers draft preparation and validation; publishing is done on Zhihu.

## Give the tools to the model

These model tools are enabled by default in your agent presets:

| Tool | Purpose |
| --- | --- |
| `zhihu_search`, `zhihu_global_search`, `zhihu_hot_list` | Zhihu search, web search, hot list |
| `zhihu_ask` | Zhida AI answers from Zhihu content |
| `zhihu_knowledge_search` | Search knowledge bases |
| `zhihu_question_recommendations`, `zhihu_question_answers` | Find questions and read answer summaries |
| `zhihu_user_content_detail`, `zhihu_user_content_comments` | Read your published content and its comments |
| `zhihu_creator_account_stats`, `zhihu_creator_content_stats` | Your creator statistics |
| `zhihu_quota` | Check official quota |
| `zhihu_sync` | Save, list, read, and validate drafts or upload images |

Site search and web search return an empty list when nothing matches, along with the service's explanation when provided.

## Cost protection

By default research requests use only Zhihu's free allowance: before each request the plugin checks the official quota and sends the request only when free quota remains. It also caps usage at 100 requests per day (Beijing time). Both are configurable:

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

Paid use is enabled only when you set `allowPaid: true` yourself.

## Limits

- Other clients sharing the same account can consume the free allowance between quota checks.
- Knowledge-base uploads are stored on Zhihu's servers and limited to 20 MB per file. Draft images are also uploaded to Zhihu.
- Drafts support articles, questions, and pins. Supported images: JPEG, PNG, GIF, WebP, and BMP (up to 15 MB for GIF, and up to 30 MB for other formats; convert HEIC/AVIF to a supported format before uploading).
- Draft and image operations use Zhihu's publishing authorization, separate from search quota and paid-search settings.
- Each request runs once without automatic retries.
- Scope covers research queries, knowledge bases, creator stats, and draft preparation; publishing drafts, OAuth account switching, top-ups, and wallet queries stay on Zhihu.

## License

[SATA License 2.1](LICENSE)
