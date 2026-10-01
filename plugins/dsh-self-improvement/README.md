# @klarkxy/dsh-self-improvement

DeepSeek Harness learns how you want work done: what to do, under which conditions, what to avoid and how to check the result. Lessons live in the shared Memory store, which you have to enable explicitly; Dream — the context observation and consolidation mechanism inside `@klarkxy/dsh-memory` — owns vocabulary, author context and recent activity, and this package only creates procedural `lesson` records.

[简体中文](docs/README.zh-CN.md)

## Standalone DSH Web

Requires Node.js ≥22 and DSH `0.1.7-rc.2`, and no application-specific runtime packages are needed. On a standalone DSH Web host, install Memory first, then this package:

```sh
dsh plugin --profile web add @klarkxy/dsh-memory
dsh plugin --profile web add @klarkxy/dsh-self-improvement
```

To uninstall, run `dsh plugin --profile web remove @klarkxy/dsh-self-improvement`.

This plugin never enables Memory or Dream on your behalf, and Dream can stay off. It adds no extra chat panel and no separate settings page. The bundle starts enabled and can be switched off independently. Review methods and Skill drafts under Settings → Long-term Memory → Experience Learning.

## Plugin page settings

`Settings → Plugins → Experience Learning` carries its own settings row with an optional **Extraction model** menu for the extraction call; reviewing and counting methods here does not call Memory's model. A saved route is used for that call as an explicit model, while an empty selection follows the live session model and then the host default chat model. Only that call is affected, and a saved route selects a model — it is not evidence of connectivity.

## Behavior

### What becomes a lesson

New `lesson` records carry a structured procedure: origin (`instruction` or `observation`), goal, applicability conditions, recommended steps, actions to avoid and verification checks. Exceptions and original evidence are retained. Descriptive corrections are skipped, and mixed messages contribute only their method clause. One-off requests, fictional dialogue and quoted documents do not become durable methods.

### What becomes active

Explicit human method requirements may become active immediately within their scope. Positive method feedback and correlated tool recoveries remain candidates until accepted, and acceptance means permission to use the method, not independent proof of its quality. Current instructions, task acceptance criteria and permissions always prevail.

### What counts as evidence

A tool recovery requires the same human request, an explicit matching target and changed arguments. The same tool succeeding elsewhere, an unknown target or an unchanged transient retry is insufficient, and even a correlated recovery is an observation rather than verified task success. Silence and assistant self-reports are not evidence. Without AI, the fallback only preserves conservative explicit method instructions, never raw error narratives or word definitions.

### How methods reach the model

Host pre-step injection uses native `createUserMessage`, preserves decision flags and inserts at most five active, unexpired, relevant lessons, about 800 tokens including the wrapper. Chinese retrieval is supported. On a continuation request, recent in-scope activity is read before selecting methods, independently of hook registration order. Disabling the plugin or losing Memory during an await stops injection.

### Skill drafts and limits

Active methods can form a Skill Markdown draft with name/description frontmatter. Preview, acceptance, browser download and revocation remain explicit: no skill is installed automatically, and no AGENTS.md or executable script is changed. Download revocation only changes the application record, not files already downloaded. Legacy lessons remain readable without inventing new metadata or validation history.

## API and exports

The package has three entry points:

- `.` — the Cordis plugin (`name`, `inject`, `apply`), the `SelfImprovementEngine` class and the shared constants `CHAT_EVENTS_SLOT` and `SELF_IMPROVEMENT_RPC_CHANNEL`. `apply` provides the engine as `ctx.selfImprovement` and registers the host RPC channel.
- `./contracts` — browser-safe types and constants: the frozen AI/Memory interfaces from `@klarkxy/dsh-plugin-kit`, plus `SkillRecord`, `ReviewSnapshot`, `LessonTrigger`, injection bounds and the `/dsh-self-improvement` channel name.
- `./client` — the review UI bundle. It provides the `dshSelfImprovementReview` render service that the Memory settings page embeds as its Experience Learning section.

The host RPC channel is `/dsh-self-improvement` with endpoints `status`, `extract`, `inspect`, `accept`, `reject`, `revoke`, `skill.preview`, `skill.accept`, `skill.reject`, `skill.revoke`, `skill.export`, `skill.exported` and `skill.unexport`.

[Design and limits](../../docs/portable-learning.md) · [Publishing](../PUBLISHING.md) · [License](LICENSE)
