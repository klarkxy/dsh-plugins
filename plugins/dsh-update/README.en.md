# @klarkxy/dsh-update

[中文](./README.md)

<!-- release-state-note -->

Preview GitHub Release changelogs between your installed version and the latest target version before updating DeepSeek Harness or any installed third-party plugin, starting and applying updates only after explicit confirmation.

## Overview

- **Intercept immediate Desktop "New version" downloads**: Clicking the sidebar "New version" pill opens a changelog modal showing every Release log between the running DSH build and the target release instead of starting an immediate download.
- **Per-plugin and batch update previews**: Adds an **Updates** tab to the Plugins page and a **Check updates / View update** action on each third-party plugin detail page, resolving versions and Release logs across both npm registry and Git-installed plugins.
- **Explicit confirmation before execution**: All update checks are strictly read-only; downloads, package replacements, and live HMR reloads begin only after you click the confirmation button inside the modal.

## Installation

While this package is still in draft before its first npm release, install it from a pinned Git commit subdirectory or a built local checkout:

```bash
dsh plugin add "git+https://github.com/klarkxy/dsh-plugins.git#<commit-sha>&path:/plugins/dsh-update"
```

Or from a local built directory:

```bash
dsh plugin add ./plugins/dsh-update
```

## Usage

1. **Preview and confirm DSH core updates**:
   - Click the Desktop **New version** button when an update is offered, or use **Settings → General** / **Plugins → Updates** to inspect Release logs between your current build and the latest release (with a toggle between active-language excerpts and full release notes when bilingual notes are available).
   - Click **Download & Update** in the modal to begin downloading; dismissing the modal leaves the running installation untouched.
2. **Preview and confirm plugin updates**:
   - Open **Plugins → Updates** to check all installed third-party plugins at once, or click **Check updates / View update** in any plugin's detail header.
   - Review the Release logs in the modal and click **Update & Apply** to install and hot-reload the updated bundle (or receive a restart notice when the host profile runs without HMR).

## Limitations

- **Relies on GitHub Releases metadata**: Changelogs are read from GitHub Releases of the repository declared by DSH or each plugin; if a plugin omits repository metadata or publishes versions without GitHub Releases, the modal notes that no Release logs were found in range and links to the repository.
- **Local linked plugins stay local**: Plugins mounted via `link:` or `file:` are not overwritten online; rebuild them in their local checkout instead.
- **Anonymous GitHub API rate limits**: When neither an authenticated `gh` CLI nor `GITHUB_TOKEN` is present on the host, requests use unauthenticated GitHub REST calls and share GitHub's anonymous rate limit.
