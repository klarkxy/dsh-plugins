# Final thread-host recovery and launcher review

Verdict: **READY** for the assigned change_review scope. No verified release blocker was found in the final retry-intent recovery or build/launcher integrity repair. This is not a verdict on unrelated repository changes or a claim that the pending official build has already been activated.

Reviewed on 2026-10-07 in `H:/Code/dsh-plugins`. The writable host remains at DSH `0.2.0-rc.2` baseline `639ed015397290b3745d163aafe02ffee4aa3f84`. No source/reference mirror, user profile, credential, release, or publication was modified. The only review additions are this report, source-hash snapshots, and the isolated reviewer test artifact described below.

## Scope and evidence

- Host `packages/api/session-controller/src/lifecycle.ts` and `tests/lifecycle-edges.host.spec.ts` are untracked additions relative to the supplied upstream baseline; the final contents were reviewed rather than relying on an absent tracked diff. The associated workflow suite and admission/command callers were inspected for the affected behavior.
- Outer `host-patches/thread-management/{start-local.mjs,build-identity.mjs,launcher.test.mjs,review-tests/retry-intent-recovery.spec.ts}` were reviewed. The known pending manifest/build regeneration is intentionally not reported as a defect.
- Six assigned-file SHA-256 hashes are preserved in `host-release-source-start.json` and `host-release-source-end.json`. All six match. Host HEAD and the assigned paths' untracked status are unchanged at review end. The outer delivery directory remains untracked, as at review start.

## Recovery assessment

The absent-branch receipt path now re-inspects the original anchor, expected branch revision, admitted/queued input revision, local tool effects, running jobs, and owned descendants before committing a replacement (`lifecycle.ts:553-589`). Persisted nonresident descendants are observed without activation (`lifecycle.ts:722-775`). Ownership lookup and observation failures are propagated in this path through `readFailures: 'throw'`, rather than converted into a harmless local refusal.

Both fresh and recovered branches synchronously validate the cut with no intervening await before append. Fresh retries do so after the durable intent write (`lifecycle.ts:300-309`); recovered retries do so after the asynchronous descendant inspection (`lifecycle.ts:563-585`). The check includes the current input/revision, parent effects/jobs, and resident owned-child activity (`lifecycle.ts:474-495`). The existing native admission queue freezes ancestor identities as well as the target, so independent child activation/input cannot enter while the parent lifecycle lease is held (`packages/core/session/src/admission.ts:151-175,199-222,246-270`).

Automatic recovery catches only the private `RetryCutRefusal` class, logs it, and retains the receipt and history; provider/checkpoint errors are rethrown (`lifecycle.ts:602-615`). New ordinary input is subsequently allowed. The restart fixture verifies a new controller prompt and fork after stale refusal, then an explicit fresh retry, without replaying the obsolete intent (`.review/integrated_host_review/retry-intent-recovery.spec.ts:58-88`).

Existing branched recovery remains separate: durable model completion, later branches, live drivers, and uncertain writes retain their existing handling (`lifecycle.ts:508-550,617-624,659-716`). The host suite verifies the unchanged intent runs once and already-branched replay does not repeat a later write (`tests/lifecycle-edges.host.spec.ts:295-319`).

## Launcher assessment

`build-identity.mjs:28-37` verifies the accepted changed-source hashes and declared removals. `build-identity.mjs:45-71` verifies official client environment identity against the baseline/version and re-digests the client/web artifacts using the upstream framing. `build-identity.mjs:75-101` compares the complete selected compiled-output set and the exact client record against the frozen accepted build. Missing, added, removed, and modified compiled outputs fail before activation.

`start-local.mjs:11-21` checks build identity and each accepted staged-plugin file before `--check` succeeds. Activation uses the repository-local isolated home, refuses a profile belonging to another owner/patch, and refuses an existing plugin link targeting another location (`start-local.mjs:23-47`). These profile checks were source-reviewed; the scoped launcher suite exercises the nonactivating integrity check, not actual profile creation or a live host launch.

## Verification

All final commands exited 0:

1. `node node_modules/vitest/vitest.mjs run packages/api/session-controller/tests/lifecycle-edges.host.spec.ts packages/api/session-controller/tests/lifecycle-workflow.host.spec.ts --maxWorkers 1` — **39 passed**, 2 files.
2. `node node_modules/vitest/vitest.mjs run --config .review/integrated_host_review/review.config.ts .review/integrated_host_review/retry-intent-recovery.spec.ts .review/integrated_host_review/sdk-branch.spec.ts .review/integrated_host_review/sdk-delete.spec.ts --maxWorkers 1` — **5 passed**, 3 files. Includes durable restart recovery and a persisted nonresident child with a real isolated filesystem-write fixture.
3. `node --test host-patches/thread-management/launcher.test.mjs` — **14 passed**.
4. `node node_modules/vitest/vitest.mjs run --config .review/integrated_host_review/review.config.ts .review/integrated_host_review/release-cut-fence.reviewer.spec.ts --maxWorkers 1` — **4 passed**. Independently probes input and filesystem-write evidence arriving during the durable intent write, checkpoint failure carrying a retry-refusal code, and an owned-session listing failure. History/receipt preservation and blocked publication are asserted.

Total: **62 passing tests** in the final scoped runs. The initial sandboxed lifecycle run executed no tests because Vitest's temporary-cache rename failed with EPERM; the same command passed with narrowly authorized host execution. One initial reviewer fixture omitted the host-required user-message surface marker; that test artifact was corrected before the final passing run. Neither issue was a production defect.

## Remaining evidence and rollback

The primary still needs to finish the official host/client build, regenerate the final patch/source/build manifest and staged plugin acceptance identity, then run the launcher `--check` against that final location. The current review does not substitute for that final-artifact check. It does not establish browser/native UI behavior, a real provider, deployment, or sustained operation; untested behavior remains held under the user's release rule.

This repair adds no new receipt schema or destructive recovery action. Refused intents keep their original history and durable receipts; failed checkpoints remain retryable and are not reported as successful admission. Rollback should preserve the isolated candidate home and its logs/lifecycle records. The broader candidate writes V5 logs, so a V4 reader must not be pointed at that home; this review does not authorize a downgrade or data conversion.

## Bounded final launcher delta

Verdict remains **READY** after the primary's authorized one-line change to `start-local.mjs:23`: the isolated home is now `.scratch/thread-management/local-home-${manifest.patchSha256.slice(0, 16)}`. This keeps the prior accepted profile intact. Replacing only that line with its previously reviewed value reproduces the original file SHA-256 `f80f5c97329322537cd605533bb45956feb4b9795332c1d41433a2bc91e318f4`; the updated file SHA-256 is `11a2df735c134548ba9a7ee1a18a4b6b3633d0068fb6614853e0791dcf26ada7`. The full patch hash is still checked in the existing profile's ownership marker, so a conflicting existing directory is refused rather than adopted.

The launcher suite was rerun independently against this delta: `node --test host-patches/thread-management/launcher.test.mjs` exited 0, **14 passed**. No broad recovery-suite redo was performed. The suite remains nonactivating; actual creation/launch of the final candidate-specific home is not claimed.

The small `verify-host-delivery.mjs` adjustment was also source-reviewed: its repository root comes from `fileURLToPath(import.meta.url)`; its fresh-baseline directory comes from `mkdtempSync`; `baseline.tar` is written inside that directory; extraction disables preserved absolute paths and skips symbolic links; link-text and accepted-source writes are constrained to that directory; patch SHA-256 is checked before `git apply --check` and apply. No defect was found in that bounded read. The verifier itself was not executed in this follow-up, and the primary's final official build/artifact check remains separate evidence.
