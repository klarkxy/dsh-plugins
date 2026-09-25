# Refresh the DSH development index

The prose is hand-curated. The scripts only check citations and render the site.

1. Clone or update [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).
2. Check out the tag or commit you intend to index. Record `git rev-parse HEAD`, `git describe --tags --exact-match`, and `git log -1 --format=%cI`.
3. Run:

```sh
node plugins/dsh-dev-index/scripts/verify-citations.mjs /path/to/deepseek-harness
```

Missing paths are the first edit list. Also read, at that commit:

- `README.md` and `packages/README.md`
- `docs/user/develop/`
- `apps/cli/README.md` and `apps/cli/reference/README.md`
- the package README for any seam you change

4. Edit `content/index.json` (`indexed`, and area `summary` / `sources` when they change) and `content/areas/<id>.md`. Every GitHub link must use the new commit. Do not add a config key, method, or event you did not read in that tree.
5. Regenerate the site and re-check:

```sh
node plugins/dsh-dev-index/scripts/build-site.mjs
node plugins/dsh-dev-index/scripts/verify-citations.mjs /path/to/deepseek-harness
pnpm --filter dsh-dev-index test
pnpm check
```

`docs/` is generated. The Pages workflow runs the same site script. Enabling Pages is a repository setting; see the root README.
