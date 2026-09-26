# Refresh the DSH development index

`docs/` is the only copy of the index. `plugins/dsh-dev-index` does not ship these files. Run this procedure once a day. Stop when the recorded official tag and commit are already current.

## Recorded revision

Read `docs/meta.json`. A daily job compares these three fields:

| Field | Meaning |
| --- | --- |
| `officialRepository` | `https://github.com/deepseek-ai/deepseek-harness` |
| `officialTag` | Official tag currently indexed, for example `dsh-v0.1.7-rc.2` |
| `officialCommit` | 40-character commit that tag points at |

`officialDocsSite` is also stored in `meta.json` and `index.json`. It is the human-readable official documentation site (`https://deepseek-harness.github.io/deepseek-harness/`). It is not a fourth revision field. A daily job still compares only the three fields above. Do not change `officialDocsSite` unless the published site origin changes.

`docs/index.json` must agree: `indexed.repository`, `indexed.tag`, and `indexed.commit` equal those three fields, and `officialDocsSite` equals `meta.json` `officialDocsSite`. `meta.json` is rewritten from `index.json` by the site script, so edit `index.json` and let the script write `meta.json`.

## 1. Resolve the latest official tag and commit

Prefer the newest GitHub Release on `deepseek-ai/deepseek-harness` whose tag matches `dsh-v*`.

```sh
curl -fsSL "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=20"
```

Take the first release whose `tag_name` starts with `dsh-v`. That list is newest first. Record:

- `LATEST_TAG` = `tag_name`
- `LATEST_COMMIT` = the peeled commit from `git ls-remote`, not the tag object itself when the tag is annotated

```sh
git ls-remote https://github.com/deepseek-ai/deepseek-harness.git "refs/tags/${LATEST_TAG}^{}"
```

If that prints nothing, the tag is lightweight. Use the line without `^{}`:

```sh
git ls-remote https://github.com/deepseek-ai/deepseek-harness.git "refs/tags/${LATEST_TAG}"
```

The commit is the first field.

If the releases API is unavailable, list tags and pick the greatest semver among `dsh-v*` (do not take the last line of `ls-remote`; ref order is not version order):

```sh
git ls-remote --tags https://github.com/deepseek-ai/deepseek-harness.git "refs/tags/dsh-v*"
```

Compare `LATEST_TAG` to `officialTag` and `LATEST_COMMIT` to `officialCommit`. If both match, stop. Do not edit files. The index tracks the latest official release, not every commit on the default branch.

## 2. Check out that commit and diff it

`RECORDED_COMMIT` is the `officialCommit` you read before editing.

```sh
git clone --branch "$LATEST_TAG" --depth 1 https://github.com/deepseek-ai/deepseek-harness.git /tmp/deepseek-harness
git -C /tmp/deepseek-harness rev-parse HEAD
git -C /tmp/deepseek-harness log -1 --format='%cI%n%s'
git -C /tmp/deepseek-harness fetch --depth 1 origin "$RECORDED_COMMIT"
git -C /tmp/deepseek-harness diff --name-only "$RECORDED_COMMIT" HEAD
```

`rev-parse HEAD` must equal `LATEST_COMMIT`. Keep the `%cI` line for `indexed.committedAt` and the subject line for `indexed.subject`. The `diff --name-only` list is the set of paths that changed between the indexed revision and the new release.

## 3. Update affected area pages, task pages, and the anti-pattern page

Open `docs/index.json`. A page is affected when any path in its `sources` is in the diff name list, when a cited path was renamed or deleted, or when the diff changes behavior that page describes. For an affected area, re-read those files in `/tmp/deepseek-harness` and edit **both** `docs/areas/<id>.md` and `docs/zh/areas/<id>.md`. Do the same for each entry in `tasks` and `guides`: edit **both** `docs/tasks/<id>.md` and `docs/zh/tasks/<id>.md`.

A task or guide is also affected when an area it lists in `areas` was edited in this refresh. Re-read the task's "how to choose" section and its verification checklist against the new upstream text and against the area page you just edited. If the mechanism advice, the checklist, or a failure note is now wrong, rewrite it. Do not stop at replacing commit hashes in links while leaving stale prose. `docs/tasks/index.md` and `docs/zh/tasks/index.md` move with any task you add, remove, or rename.

Leave every unaffected page's prose unchanged, in both languages.

Write the English page in English and the Chinese page in Simplified Chinese. Do not leave a Chinese sentence on an English page, or an English sentence on a Chinese page. Identifiers, paths, code fences, and quoted upstream strings stay as they appear in the source. On an English page the only CJK is the link text `中文`. On a Chinese page the link back is the word `English`.

Do not add a config key, method, event, or default you did not read in the new tree.

## 4. Pin links to the new commit

In every `docs/areas/*.md`, `docs/zh/areas/*.md`, `docs/tasks/*.md`, and `docs/zh/tasks/*.md` file, replace the previous commit in:

`https://github.com/deepseek-ai/deepseek-harness/blob/<sha>/<path>`

with `LATEST_COMMIT`. Each area, task, and guide page, in both languages, must still contain `LATEST_COMMIT` and every path listed in that entry's `sources`. Task pages must still link to each id in `areas`, and must still say `Runnable example: not yet (planned)` until a later round ships a pack. Do not flip `runnableExample` away from `not-yet` in this refresh.

Keep the reading links to the official documentation site valid. The site is built from that commit's `website/docs.ts` (`docsPages`, `routeLink`). A repository path is published when it equals a page's `source` or appears in `sourceAliases`. English pages link to the `en` locale (`/en/...`). Chinese pages link to the `root` locale, which is Simplified Chinese at the site root. The URL is `officialDocsSite` plus `routeLink(route)` without its leading slash. `routeLink` drops a trailing `.md`, and drops a trailing `index.md` so directory routes keep a trailing slash. Put the reading link immediately after the pinned blob citation: ` ([official site](URL))` in English, `（[官方文档](URL)）` in Chinese. The blob citation stays the authoritative source. The site link is for reading, and the live site is the latest published `dsh-v*` release, which may differ from `officialCommit`.

If `website/docs.ts` is in the diff, or a cited `docs/` path's route changes, re-derive every affected reading link. Do not stop at replacing commit hashes. Paths the manifest does not publish stay blob-only. At this pin, `docs/development.md` is one of those. Package READMEs, source files, and skills are not site pages. The homepage entry stays: English links to `officialDocsSite` + `en/`, Chinese links to `officialDocsSite`. Both may also link `llms.txt` at the site root.

## 5. Record the new revision

Edit `docs/index.json`:

- `indexed.tag` = `LATEST_TAG`
- `indexed.commit` = `LATEST_COMMIT`
- `indexed.committedAt` = the `%cI` value
- `indexed.subject` = the subject line
- `summary` and `sources` only for areas whose prose changed

`index.json` and `meta.json` stay in English. `file` remains the English page. For an area, `fileZh` is `zh/areas/<id>.md`. For a task or guide, `fileZh` is `zh/tasks/<id>.md`. Do not put Chinese prose in `index.json`. The Chinese opening paragraph is the Chinese summary the index page shows. There is no `summaryZh` field. `tasks` and `guides` record `areas` (area ids that page must link) and `runnableExample`. Round 1 leaves `runnableExample` at `not-yet`.

Do not hand-edit `docs/meta.json`. The next command rewrites it. Keep `officialRepository`, `officialTag`, and `officialCommit` as the three fields a daily job compares. Those three fields are the DSH revision the pages were written against. The skill tells an agent to compare them with the target version and, on a mismatch, treat the pages as unverified. `officialDocsSite` is copied through unchanged unless the published site origin changed. If that origin changes, update the same URL in `plugins/dsh-dev-index/src/skill-body.ts`. A commit bump that keeps the same site does not require a plugin release.

If you added, removed, or renamed an area id, also update `AREA_IDS` in `plugins/dsh-dev-index/src/skill-body.ts`. If you added, removed, or renamed a task id, update `TASK_IDS` there too. The skill lists those ids in the same order. Add both language files for any new id. A commit bump that does not change ids does not touch the plugin. Do not copy markdown into the package. The skill keeps pointing at the English files and may mention that `zh/` exists.

## 6. Regenerate rendered files and check

From the repository root:

```sh
node plugins/dsh-dev-index/scripts/build-site.mjs
node plugins/dsh-dev-index/scripts/verify-citations.mjs /tmp/deepseek-harness
node plugins/dsh-dev-index/scripts/check-languages.mjs
pnpm check
```

`build-site.mjs` reads `docs/index.json`, the area markdown, and the task and guide markdown, including `docs/tasks/index.md` and `docs/zh/tasks/index.md`. It rewrites these in place:

- `docs/meta.json` (`officialRepository`, `officialTag`, `officialCommit`, `officialDocsSite`)
- `docs/llms.txt` and `docs/zh/llms.txt`
- `docs/index.html` and `docs/zh/index.html`
- `docs/areas/*.html` and `docs/zh/areas/*.html`
- `docs/tasks/*.html` and `docs/zh/tasks/*.html`
- `docs/assets/site.css`
- `docs/.nojekyll`

It does not delete `docs/`, and it does not rewrite `docs/index.json` or the area markdown.

`verify-citations.mjs` fails unless `meta.json` matches `index.json` (including `officialDocsSite`), every English and Chinese area, task, and guide page names the recorded commit and its `sources`, and each cited path exists in the checkout. It also loads `website/docs.ts` from that checkout and fails unless each published `docs/` citation has the locale's reading link, and official-site links stay on `officialDocsSite` (English pages under `/en/` or `llms.txt`; Chinese pages stay off `/en/`). It refuses to skip when the checkout argument or `website/docs.ts` is missing.

`check-languages.mjs` fails if an English docs file contains CJK outside the `中文` language-switch link, or if a Chinese twin or its HTML is missing for any area, task, or guide. It also fails when a Chinese page contains a run of English words outside code, identifiers, and the `English` link, when a task does not link its `areas`, or when a task or guide drops the runnable-example placeholder. `pnpm check` runs the same script. Read both versions of any page you edited and confirm neither one mixes languages.

`plugins/dsh-dev-index/tests/catalog.test.ts` checks the same cited paths when `DSH_CHECKOUT` (default `/tmp/deepseek-harness`) contains `packages/README.md`. Without that checkout it prints a `SKIP source-path check` warning and skips the test. It does not pass quietly. CI runs `plugins/dsh-dev-index/scripts/fetch-pinned.mjs` first so the check executes against `officialCommit`. Set `DSH_REQUIRE_CHECKOUT=1` to fail instead of skip.

## 7. Commit

Commit `docs/`, including `docs/zh/`. Include `plugins/dsh-dev-index/src/skill-body.ts` only when area ids changed.

GitHub Pages publishes `docs/` from `.github/workflows/pages.yml` on push to `main`. The site URL is `https://klarkxy.github.io/dsh-plugins/`. The repository setting Pages → Source must be GitHub Actions before that URL serves. Raw files on `main` remain available at `https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/` either way.
