# @klarkxy/dsh-zhihu

Zhihu search, answers, question discovery, creator data, knowledge bases, and usage tracking for DSH.

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

DSH Web provides search, settings, usage, and knowledge-base views. Open **Plugins → @klarkxy/dsh-zhihu** for configuration, usage, knowledge bases, and search. Question discovery, creator data, and official quota queries are available through the agent tools and shared RPC service; this update does not add dedicated Web views for them.

Twelve agent tools are available once the tools entry is enabled. The five existing tools are unchanged:

- `zhihu_search`: search within Zhihu for community evidence; results are community/reader feedback only, never canon, and never written into project files.
- `zhihu_global_search`: search the wider web beyond Zhihu through the open platform's global search; reference only.
- `zhihu_hot_list`: pull the Zhihu hot list to see current community trends; reference for topics and hotspots only.
- `zhihu_ask`: ask Zhihu 直答, an OpenAI-compatible AI answer service grounded in Zhihu community content; suited for research and background investigation.
- `zhihu_knowledge_search`: retrieve RAG fragments from Zhihu knowledge bases — public bases by default, with personal and subscription recall scopes available after you upload material on Zhihu's web side.

### Question discovery and creator data

Aligned with [zhihu-search PR #4](https://github.com/klarkxy/zhihu-search/pull/4) and upstream `main` at `62fd3ce5c5761dd217094280390b394e4eb77ed2` (2026-09-28). All seven additions use **only the current Access Secret**. They neither accept an OAuth identity switch nor expose credentials as tool parameters.

| Agent tool | RPC endpoint on `/zhihu` | Parameters | Official quota |
| --- | --- | --- | --- |
| `zhihu_question_recommendations` | `question.recommendations` | Optional `query`; `count` 1–20, default 5 | `creator` |
| `zhihu_question_answers` | `question.answers` | `questionUrl`; `offset`, `limit` | `question_answers` |
| `zhihu_user_content_detail` | `content.detail` | `contentUrl` | `creator` |
| `zhihu_user_content_comments` | `content.comments` | `contentUrl`; `offset`, `limit`; `order`: `score` (default), `reverse`, `ascending` | `creator` |
| `zhihu_creator_account_stats` | `creator.account.stats` | `contentType`: `all` (default), `answer`, `article`, `pin`, `zvideo`; paired dates | `creator` |
| `zhihu_creator_content_stats` | `creator.content.stats` | `contentUrl`; paired dates | `creator` |
| `zhihu_quota` | `quota` | Optional `apiIds` array; omit or `[]` for all | None |

The service also accepts upstream-style underscore aliases such as `question_recommendations`, `question_answers`, `content_detail`, `content_comments`, `creator_account_stats`, and `creator_content_stats` (plus `user_content_detail` / `user_content_comments`). Parameter names remain camelCase as shown above.

Omit `query` to get profile-based recommendations. An explicitly empty or whitespace-only theme is rejected. Recommendations do not paginate. `questionUrl` must be an HTTPS `www.zhihu.com/question/{id}` link. `contentUrl` must be a Zhihu answer, column article, pin, or video link; creator endpoints apply only to content published by the current account. Video details contain associated text, not video files.

Paged tools accept `offset` as a non-negative Int64 **decimal string**, default `"0"`; RPC also accepts safe JavaScript integers. `limit` is an integer from 1 to 50, default 20. Every call fetches one page. Only continue when `paging.canContinue` is true, using its `nextOffset` verbatim. A short or empty page is not the end; missing, invalid, non-advancing, or unsafe numeric `NextOffset` stops pagination with a warning. Never derive the next offset from item counts. `Totals` may include filtered answers; `Summary` is an upstream excerpt, not full text or a newly generated AI summary. Attached comment `Children` may be incomplete.

Both statistics tools require `startDate` and `endDate` together, as valid `YYYY-MM-DD` calendar dates with end ≥ start. Omit both for the upstream default range; no range is invented locally. Missing metrics stay missing and ratios are not converted to percentages. New results contain `version`, `operation`, `data`, optional `quotaId`, and optional safe `paging`. Structured `data` retains the original upstream fields and HTML; tool rendering strips HTML and displays inert fenced text. Empty/missing `Body` is not presented as full text.

### Official quota versus local usage

`zhihu_quota` calls `GET /api/v1/quota`; it is the only source of official remaining quota. Its `apiIds` allowlist is `global_search`, `zhihu_search`, `hot_list`, `question_answers`, `zhida_openai`, `tools`, `knowledge`, `user_data`, and `creator`. Duplicate IDs are removed in first-seen order. Quota reads do not emit business-usage events, even on failure. No remaining-quota prediction, reset countdown, or automatic retry is added.

Local usage is still tracked as daily counters of calls, failures, and returned results; usage views default to the last 30 days and accept at most 90. New business operations emit one event per tool/RPC call, with their quota category; local counters are not a billing ledger or official balance. Existing storage identifiers are unchanged. Knowledge-base uploads remain limited to 20 MB per file.

Business errors retain their upstream message and code, including on HTTP error responses. RPC `error.details` may contain `status`, `upstreamCode`, `retryAfter` (seconds), and `retryable`. `30001` / `30002` are rate/quota limits; **`30003` is risk-control rejection, not an ordinary rate limit** and tells callers not to retry immediately. No request is automatically retried. Timeouts and cancellation cover response-body reads as well as the initial request.

Search covers Zhihu in-site search, the wider web, the hot list, Zhihu 直答 AI answers, and public knowledge bases. Uploaded reference files are stored in Zhihu's cloud; do not upload unpublished manuscripts.

When [@klarkxy/dsh-web-search-manager](https://www.npmjs.com/package/@klarkxy/dsh-web-search-manager) is also installed in the same profile, this plugin registers **Zhihu global search** as a provider in its web search settings. Enable that provider to use Zhihu's global search through the standard web search tool with the Access Secret from Zhihu settings. The dedicated Zhihu tools work independently.

## Development

Read [contracts](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/contracts.ts), [tools](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/tools.ts), and [open-platform client](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/src/open-platform.ts) for the API. This sync covers the six question/creator endpoints and official quota, not all upstream CLI/MCP features (such as OAuth management or PDF/PPT tasks).

```sh
pnpm --filter @klarkxy/dsh-zhihu typecheck
pnpm --filter @klarkxy/dsh-zhihu test
pnpm --filter @klarkxy/dsh-zhihu build
```

[Publishing](https://github.com/klarkxy/dsh-plugins/blob/main/docs/editor-plugin-migration.md) · [License](https://github.com/klarkxy/dsh-plugins/blob/main/plugins/dsh-zhihu/LICENSE)

The client accepts structural host controls and has native HTML fallbacks. Building or using this package does not require application-private UI packages. Existing agent tools, credentials, RPC contracts and storage identifiers are preserved; the additions above are additive.
