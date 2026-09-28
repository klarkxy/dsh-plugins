# @klarkxy/dsh-zhihu

Zhihu search, answers, knowledge bases, and usage tracking for DSH.

[简体中文](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/docs/README.zh-CN.md)

## Install

Requires Node.js ≥22 and DSH `0.1.7-rc.2`. No repository build is needed. Install:

```sh
npm install @klarkxy/dsh-zhihu
```

Then load it:

```sh
dsh plugin --profile web add @klarkxy/dsh-zhihu
```

Restart DSH Web, open **Plugins → @klarkxy/dsh-zhihu**, and enter your Access Secret (DSH credential `ZHIHU_ACCESS_TOKEN`). Use the full scoped name; the unscoped `dsh-zhihu` package belongs to another maintainer.

To enable agent tools, add this entry to the plugin list in the agent's `agent.cordis.yml`:

```yaml
- name: '@klarkxy/dsh-zhihu/tools'
```

## Use

DSH Web provides search, settings, usage, and knowledge-base views. Open **Plugins → @klarkxy/dsh-zhihu** for configuration, usage, knowledge bases, and search; the agent tools are included.

Eleven agent tools are available once the tools entry is enabled:

- `zhihu_search`: search within Zhihu for community evidence; results are community/reader feedback only, never canon, and never written into project files.
- `zhihu_global_search`: search the wider web beyond Zhihu through the open platform's global search; reference only.
- `zhihu_hot_list`: pull the Zhihu hot list to see current community trends; reference for topics and hotspots only.
- `zhihu_ask`: ask Zhihu 直答, an OpenAI-compatible AI answer service grounded in Zhihu community content; suited for research and background investigation.
- `zhihu_knowledge_search`: retrieve RAG fragments from Zhihu knowledge bases — public bases by default, with personal and subscription recall scopes available after you upload material on Zhihu's web side.

The six question-discovery and creator tools use **only the current Access Secret**. They do not accept OAuth tokens or another user identity. Creator detail, comments and statistics cover the current account's published content; this is not a way to fetch other people's full answers. Video detail returns associated text, not a video file.

| Tool | Service RPC | Official quota group |
| --- | --- | --- |
| `zhihu_question_recommendations` | `question.recommendations` | `creator` |
| `zhihu_question_answers` | `question.answers` | `question_answers` |
| `zhihu_content_detail` | `content.detail` | `creator` |
| `zhihu_content_comments` | `content.comments` | `creator` |
| `zhihu_creator_account_stats` | `creator.account.stats` | `creator` |
| `zhihu_creator_content_stats` | `creator.content.stats` | `creator` |

- Recommendations: omit `query` for profile-based recommendations, or provide a nonblank topic. `count` defaults to 5 (1–20); there is no pagination.
- Answers: pass `questionUrl` as `https://www.zhihu.com/question/{id}`. `Summary` is an upstream excerpt, not the full answer or an additional AI summary.
- Detail/comments/content statistics: pass `contentUrl` for an answer, a `zhuanlan.zhihu.com/p/{id}` article, a pin or a video. Empty or missing `Body` is not full text.
- Answers and comments: one page per call; `limit` defaults to 20 (1–50). Agent tools accept `offset` as a decimal string (default `"0"`); direct clients and RPC also accept safe integer numbers. Use `paging.nextOffset` only when `paging.canContinue` is true. Missing, invalid or non-increasing offsets stop pagination. Short/empty pages and `Totals` cannot be used to calculate an offset. Comments accept `order`: `score` (default), `reverse` or `ascending`; attached child comments may be incomplete.
- Account statistics: `contentType` is `all` (default), `answer`, `article`, `pin` or `zvideo`. Both statistics tools accept `startDate` and `endDate` in `YYYY-MM-DD`, provided together with the end no earlier than the start. Omit both to use the upstream default range. Missing metrics stay missing and ratios are not converted to percentages.

New tools/RPC return `{ version, data, paging? }`. `data` preserves upstream fields (including raw HTML); integers beyond JavaScript's safe range are decimal strings. Tool text rendering cleans and escapes HTML in bodies, summaries and comments. Any other consumer of `data` must treat it as untrusted content. API code `30003` is a `RISK_CONTROL` / RPC `risk-control` error with a “do not immediately retry” message, distinct from rate/quota limits (`30001`, `30002`, HTTP 429); no automatic retry is performed.

Usage is tracked as daily counters of calls, failures, and returned results; usage views default to the last 30 days and accept at most 90. The optional `quotas` breakdown groups new local counters by official API quota category; existing rows remain readable and their historical categories are not inferred. These counters include local failures and are not official remaining balances or billed usage. Knowledge-base uploads are limited to 20 MB per file.

Search covers Zhihu in-site search, the wider web, the hot list, Zhihu 直答 AI answers, and public knowledge bases. Uploaded reference files are stored in Zhihu's cloud; do not upload unpublished manuscripts.

When [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) is also installed in the same profile, this plugin registers **Zhihu global search** as a provider in its web search settings. Enable that provider to use Zhihu's global search through the standard web search tool with the Access Secret from Zhihu settings. The dedicated Zhihu tools work independently.

## Development

Read [contracts](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/contracts.ts) and [tools](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/tools.ts) for the API.

[Publishing](https://github.com/klarkxy/dsh-plugins/blob/main/docs/editor-plugin-migration.md) · [License](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/LICENSE)

The client accepts structural host controls and has native HTML fallbacks. Building or using this package does not require application-private UI packages. Existing tool names, credential references, RPC endpoints and storage identifiers remain compatible. The six APIs follow [zhihu-search PR #4](https://github.com/klarkxy/zhihu-search/pull/4), checked against upstream main `62fd3ce` and this repository main `ca189a2`.
