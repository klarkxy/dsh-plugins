# Zhihu

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Use Zhihu as a research source for the model: site search, web search, hot list, Zhida answers, knowledge bases, question discovery, and creator statistics. Every request uses your own Zhihu Access Secret; results are reference material, not conclusions.

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
- **Test**: run any search or query by hand.

With the Web Search plugin installed, Zhihu web search also appears in its provider list.

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

## Cost protection

By default the plugin uses only Zhihu's free allowance: before each request it checks the official quota and skips the request if none is left. It also stops after 100 requests per day (Beijing time). Both are configurable:

```yaml
config:
  allowPaid: false
  dailyCallLimit: 100
```

Paid use is allowed only when you set `allowPaid: true` yourself.

## Limits

- Zero cost is not guaranteed: other clients on the same account can use up the free allowance first.
- Uploaded files are stored on Zhihu's servers; do not upload unpublished manuscripts. Each file is limited to 20 MB.
- Requests are never retried automatically.
- Not included: OAuth account switching, top-ups, or wallet queries.

## License

[SATA License 2.1](LICENSE)
