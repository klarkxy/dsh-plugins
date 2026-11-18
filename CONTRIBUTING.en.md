# Contributing

English / [简体中文](CONTRIBUTING.md)

This repository is a DeepSeek Harness plugin monorepo. Build and test the package you changed. Record interface acceptance with the repo-level `dsh-web-acceptance` skill. Do not reuse another repository's single-package paths.

## Before pushing

```sh
pnpm check
```

For a one-package change, run that package's `build`, `typecheck`, and `test`. After changing the acceptance runner, run `pnpm test:acceptance`. `pnpm check` includes it.

Do not bump plugin versions or publish from a feature PR. Release rules are in [RELEASING.md](RELEASING.md).

## Pull requests

Open the pull request against `main`. Keep it to one change. Write the title as a sentence someone can review.

A maintainer merges. Automation that implements or reviews the change does not merge, enable auto-merge, push `main`, delete the branch, or force-push.

## User-visible interface

Authors follow this rule. Reviewers compare the body with the diff. CI does not look for the GIF.

When a pull request changes what a person sees or does in DeepSeek Harness, the body contains a real GIF recorded from **this pull request's code** before it is merged. That includes client components, interface copy, icons, and any other diff that changes the interaction or the picture.

The GIF shows the changed action and the result on screen, and the body names:

- the commit that was recorded (`git rev-parse HEAD`)
- the scenarios it covers
- what differs when that commit is not the current head. Record again after a later interface change

Embed the GIF, or link an image URL that renders in the body. Leave the file off the branch.

A generated animation, a static mock, a fixture page, a sentence that says a recording exists, or a recording from an older commit does not meet the rule.

Record with `.agents/skills/dsh-web-acceptance/`. The script starts an isolated `dsh web` in a temporary home, exchanges the launch token for an HttpOnly cookie, and writes screenshots and GIFs outside the checkout. Do not use a personal home, keys, accounts, production, or a paid API. `--mock-shell` is the no-service shell smoke.

When the interface is unchanged, say why — documentation, server behavior, or tests. Do not add a GIF that shows nothing relevant. A note that the change is small, internal, or easy to miss does not replace the GIF when the interface did change.

The GIF does not replace automated tests or an independent review.

## Acceptance tooling stays out of npm packs

`.agents/` is developer tooling. Plugin `files` lists do not ship it, and the root `.npmignore` excludes it. Do not put acceptance artifacts in a plugin package.
