# Refresh the DSH development index

`docs/` is the only copy of the index. `plugins/dsh-dev-index` does not ship these files. Run this procedure once a day. Stop when the recorded official tag and commit are already current.

## Recorded revision

Read `docs/meta.json`. A daily job compares these three fields:

| Field | Meaning |
| --- | --- |
| `officialRepository` | `https://github.com/deepseek-ai/deepseek-harness` |
| `officialTag` | Official tag currently indexed, for example `dsh-v0.1.7-rc.2` |
| `officialCommit` | 40-character commit that tag points at |

`docs/index.json` must agree: `indexed.repository`, `indexed.tag`, and `indexed.commit` equal those three fields. `meta.json` is rewritten from `index.json` by the site script, so edit `index.json` and let the script write `meta.json`.

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

## 3. Update affected area pages in both languages

Open `docs/index.json`. For each area, if any path in `sources` is in that name list, or a cited path was renamed or deleted, re-read those files in `/tmp/deepseek-harness` and edit **both** `docs/areas/<id>.md` and `docs/zh/areas/<id>.md`. Also update an area when the diff changes behavior that page describes, even if you have to add or remove a path in `sources`. Leave every other area's prose unchanged, in both languages.

Write the English page in English and the Chinese page in Simplified Chinese. Do not leave a Chinese sentence on an English page, or an English sentence on a Chinese page. Identifiers, paths, code fences, and quoted upstream strings stay as they appear in the source. On an English page the only CJK is the link text `中文`. On a Chinese page the link back is the word `English`.

Do not add a config key, method, event, or default you did not read in the new tree.

## 4. Pin links to the new commit

In every `docs/areas/*.md` file and every `docs/zh/areas/*.md` file, replace the previous commit in:

`https://github.com/deepseek-ai/deepseek-harness/blob/<sha>/<path>`

with `LATEST_COMMIT`. Each page, in both languages, must still contain `LATEST_COMMIT` and every path listed in that area's `sources`.

## 5. Record the new revision

Edit `docs/index.json`:

- `indexed.tag` = `LATEST_TAG`
- `indexed.commit` = `LATEST_COMMIT`
- `indexed.committedAt` = the `%cI` value
- `indexed.subject` = the subject line
- `summary` and `sources` only for areas whose prose changed

`index.json` and `meta.json` stay in English. `file` remains the English page. `fileZh` is `zh/areas/<id>.md`. Do not put Chinese prose in `index.json`. The Chinese opening paragraph in `docs/zh/areas/<id>.md` is the Chinese summary the index page shows. There is no `summaryZh` field.

Do not hand-edit `docs/meta.json`. The next command rewrites it. Keep `officialRepository`, `officialTag`, and `officialCommit` as the three fields a daily job compares.

If you added, removed, or renamed an area id, also update `AREA_IDS` in `plugins/dsh-dev-index/src/skill-body.ts` so the skill lists the same ids in the same order, and add both `docs/areas/<id>.md` and `docs/zh/areas/<id>.md`. A commit bump that does not change area ids does not touch the plugin. Do not copy markdown into the package. The skill keeps pointing at the English files and may mention that `zh/` exists.

## 6. Regenerate rendered files and check

From the repository root:

```sh
node plugins/dsh-dev-index/scripts/build-site.mjs
node plugins/dsh-dev-index/scripts/verify-citations.mjs /tmp/deepseek-harness
node plugins/dsh-dev-index/scripts/check-languages.mjs
pnpm check
```

`build-site.mjs` reads `docs/index.json`, `docs/areas/*.md`, and `docs/zh/areas/*.md`. It rewrites these in place:

- `docs/meta.json` (`officialRepository`, `officialTag`, `officialCommit`)
- `docs/llms.txt` and `docs/zh/llms.txt`
- `docs/index.html` and `docs/zh/index.html`
- `docs/areas/*.html` and `docs/zh/areas/*.html`
- `docs/assets/site.css`
- `docs/.nojekyll`

It does not delete `docs/`, and it does not rewrite `docs/index.json` or the area markdown.

`verify-citations.mjs` fails unless `meta.json` matches `index.json`, every English and Chinese area page names the recorded commit and its `sources`, and each cited path exists in the checkout.

`check-languages.mjs` fails if an English docs file contains CJK outside the `中文` language-switch link, or if `docs/zh/areas/<id>.md` or `docs/zh/areas/<id>.html` is missing for any area id. It also fails when a Chinese page contains a run of English words outside code, identifiers, and the `English` link. `pnpm check` runs the same script. Read both versions of any area you edited and confirm neither one mixes languages.

## 7. Commit

Commit `docs/`, including `docs/zh/`. Include `plugins/dsh-dev-index/src/skill-body.ts` only when area ids changed.

GitHub Pages publishes `docs/` from `.github/workflows/pages.yml` on push to `main`. The site URL is `https://klarkxy.github.io/dsh-plugins/`. The repository setting Pages → Source must be GitHub Actions before that URL serves. Raw files on `main` remain available at `https://raw.githubusercontent.com/klarkxy/dsh-plugins/main/docs/` either way.
