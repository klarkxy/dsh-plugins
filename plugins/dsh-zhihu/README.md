# Zhihu

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Use Zhihu as a research source for the model: site search, web search, hot list, Zhida answers, knowledge bases, question discovery, and creator statistics. The `zhihu_sync` tool also saves and validates article, question, or pin drafts and uploads images; actual publication requires a human-confirmed UI review. Every request uses your own Zhihu Access Secret; results are reference material, not conclusions.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Replace `web` with your profile name and restart DSH Web. Use the full scoped name; the unscoped `dsh-zhihu` belongs to someone else.

## Use

Open **Plugins → Zhihu** and enter your Access Secret under **Settings**. Other tabs:

- **Stats**: local daily calls, failures, and result counts;
- **Official quota**: remaining free allowance as reported by Zhihu;
- **Knowledge base**: upload and search reference files;
- **Test**: run any search or query by hand, expand an answer's reasoning, and inspect or copy structured response data.

With the Web Search plugin installed, Zhihu web search also appears in its provider list.

## Drafts and media

In **Plugins → Zhihu → Settings**, configure the publishing App Key and App Secret obtained from the [Zhihu publishing assistant](https://www.zhihu.com/playground/zhihu-publisher). These are separate from the search Access Secret. The `zhihu_sync` tool then lets the model save, list, read, and validate drafts for articles, questions, or pins, and upload images for them. Drafts persist across DSH restarts. Publication itself is not exposed to the model; it requires a human-confirmed UI review.

## Give the tools to the model

These model tools are enabled by default; no agent preset changes needed:

| Tool | Purpose |
| --- | --- |
| `zhihu_search`, `zhihu_global_search`, `zhihu_hot_list` | Zhihu search, web search, hot list |
| `zhihu_ask` | Zhida AI answers from Zhihu content |
| `zhihu_knowledge_search` | Search knowledge bases |
| `zhihu_question_recommendations`, `zhihu_question_answers` | Find questions and read answer summaries |
| `zhihu_user_content_detail`, `zhihu_user_content_comments` | Read your published content and its comments |
| `zhihu_creator_account_stats`, `zhihu_creator_content_stats` | Your creator statistics |
| `zhihu_quota` | Check official quota |
| `zhihu_sync` | Save, list, read, and validate drafts or upload images; publication needs a human-confirmed UI review |

## Cost protection

By default research requests use only Zhihu's free allowance: before each request the plugin checks the official quota and skips the request if none is left. It also stops after 100 requests per day (Beijing time). Both are configurable:

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

Paid use is allowed only when you set `allowPaid: true` yourself.

## Limits

- Zero cost is not guaranteed: other clients on the same account can use up the free allowance first.
- Knowledge-base uploads are stored on Zhihu's servers and limited to 20 MB per file. Draft images are also uploaded to Zhihu.
- Drafts support articles, questions, and pins, not answers or videos. Supported images: JPEG, PNG, GIF, WebP, and BMP; GIF is limited to 15 MB and other images to 30 MB. Convert HEIC/AVIF before uploading.
- Draft and image operations use Zhihu's publishing authorization; search quota and paid-search settings do not govern them.
- Requests are never retried automatically.
- Not included: OAuth account switching, top-ups, or wallet queries.

## License

[SATA License 2.1](LICENSE)
