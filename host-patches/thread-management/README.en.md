# Thread management local candidate

[简体中文](README.md) / English

This directory holds the host patch, plugin tarballs, acceptance records, and independent review results. It implements cross-directory session lookup and paged reading, copying thread IDs, safe in-session retry and edit-and-resend, and free chat, forking, and real deletion with isolated working directories.

## Using the accepted build

Run from the repository root:

```powershell
node host-patches/thread-management/start-local.mjs --check
node host-patches/thread-management/start-local.mjs
```

The launcher verifies source hashes for patched files, frozen compiled outputs, and the official client build record before starting the candidate Web host. It uses an isolated config, session, and workspace directory under `.scratch/thread-management/local-home-<hash-prefix>` keyed by the patch hash, preserving earlier candidate directories. Models must be configured separately inside this isolated instance.

Initial mock-model acceptance remains in the history; on 2026-10-07 a real Web fix re-verification completed against the workspace plugin using `MiniMax-M3.1-Flash-Preview` — see [Fix acceptance](fix-acceptance.json) and [Independent review](fix-independent-review.md). Long-running real-provider sessions have not been tested, and existing desktop installations were neither modified, restarted, nor overwritten.

This round of host fixes reschedules title generation after editing or retrying on an active branch while keeping human manual names intact; an explicit refresh unlocks pinned names. The final patch, full official build, and source and artifact hashes are synchronized, and [`reproduction-check.json`](reproduction-check.json) confirms application against the exact upstream baseline. [`acceptance.json`](acceptance.json) records the targeted re-verification, while the initial broad acceptance is recorded in [`historical-acceptance-before-fixes.json`](historical-acceptance-before-fixes.json).

`plugins/dsh-session-manager` entered the npm `next` prerelease channel at `0.1.0-rc.1`; this directory retains the accepted `.tgz` archives and their exact checksums. An unpatched host supports cross-directory lookup, paged reading, and copying thread IDs; free chat and in-thread resend depend on host capabilities added by this patch and appear only when the host advertises them. Installing the plugin alone does not mean all capabilities are enabled.

## Rebuilding from the patch

[`manifest.json`](manifest.json) records the upstream URL, exact baseline commit, patch hash, each final source file hash, compiled output hashes, official client build record, and plugin package checksums. Use a fresh empty directory and never run inside an existing installation or reference mirror:

```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git <new-host-dir>
git -C <new-host-dir> checkout 639ed015397290b3745d163aafe02ffee4aa3f84
git -C <new-host-dir> apply --check <absolute-path-to-this-dir>/host.patch
git -C <new-host-dir> apply <absolute-path-to-this-dir>/host.patch
```

In the new host directory, build with Node 24+ and pnpm 11.7.0:

```powershell
pnpm install --frozen-lockfile
pnpm run build:official
```

`acceptance-tests/` and `review-tests/` hold credential-free acceptance fixtures; copy them to `.acceptance/` and `.review/integrated_host_review/` in the new host directory to preserve relative imports. Real-page acceptance also requires unpacking the plugin tarball into `.acceptance/runtime-plugin/` with only the top-level `package/` directory stripped and without installing devDependencies. From the new host directory, run `node .acceptance/prepare-runtime-plugin.mjs <absolute-path-to-tarball>`; any existing staged plugin is preserved and will not be overwritten.

Compiled outputs vary across platforms and toolchains; a rebuild in a new directory requires re-running acceptance and generating a new build identity record rather than reusing this candidate's compiled hashes. [`build-identity.mjs`](build-identity.mjs) only emits records and does not approve a new build on its own.

## Data and rollback

The patched host writes V5 session logs. V4 readers reject V5 logs; when rolling back, preserve the new logs and lifecycle records and do not point an older installation at this isolated data. Deletion affects only the user-selected session and resources with proven ownership; free directories without valid ownership proof refuse cleanup and preserve the session log. The SQLite search index can be rebuilt.

In-session retry and edit only switch the active conversation branch and do not undo file or external modifications. When subsequent edits are detected, callers must explicitly confirm before continuing; running work or missing tool side-effect evidence still blocks rollback.

An earlier test fixture omitted an isolated directory, allowing an old check helper to attempt creating an empty `free-workspaces` parent directory under the real DSH directory. No real sessions or credentials were read; the fixture is now isolated and the check helper is read-only. Prior ownership of that real directory could not be confirmed, so it was preserved; all other acceptance runs used isolated directories.

Source and test licensing is documented in [`UPSTREAM-LICENSE`](UPSTREAM-LICENSE). Detailed results appear in [`acceptance.json`](acceptance.json) and [`independent-review.md`](independent-review.md).

## Verification scope and notes

This round fixed the risk of a branchless retry intent overwriting newer inputs during recovery. Recovery re-verifies split points, inputs, quiescent state, and side effects across resident and cold child threads; stale intents remain recorded and are explicitly rejected while allowing ordinary new inputs and forks. Genuine persistence or ownership read errors still propagate rather than being swallowed as stale rejections.

The final official host build, 263 source patch reproductions, 62 independent fix-review tests, 8 ownership/recovery/deletion/compaction acceptance checks, and 2 compiled SDK/remote interface checks all passed. The final tarball also passed create, send, same-ID edit-and-resend, fork file copying, deletion, and narrow-viewport flows in real host pages. These results come from isolated host acceptance and do not represent an installed desktop application or long-running real-provider operation.

The historical multi-agent audit lacked some start/end and compaction checkpoint records, so scheduling-evidence completeness is not claimed. All currently visible actors have completed, and product conclusions rest on source inspection, independent review, build records, and real-page evidence.
