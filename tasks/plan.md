# Implementation Plan: DSH plugin collection and current-task titles

## Architecture

- Keep the repository root private and non-installable.
- Put each independently installable DSH bundle under `plugins/`.
- Build `dsh-current-title` against the DSH `0.1.2-rc.1` provider contract.
- Disable the default `session-title-llm` row and insert the replacement provider without modifying DSH itself.

## Current-title behavior

- Recompute asynchronously after each eligible human prompt.
- Prefer up to eight recent prompts within the complete 4096-byte framed-input budget.
- Produce `MMDD | localized type | concise summary` from stable semantic type keys and preserve manual-title pinning.
- Keep the previous title when model output or routing fails.

## Verification

- Typecheck, unit/integration tests, production build, and package dry-run.
- Validate the bundle patch against a disposable DSH profile when a compatible CLI is available.
