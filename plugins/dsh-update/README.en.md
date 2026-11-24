# Update and Changelog Preview

<!-- release-state-note -->

[简体中文](README.md) / English

Preview GitHub Release changelogs between your installed version and the latest target version before updating DeepSeek Harness or any installed third-party plugin, starting and applying updates only after explicit confirmation.

## Demo

![Plugins → Updates: compact list, filters, and narrow layouts](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr34-update-list-final.gif)

![Desktop update: confirm the changelog, then hand the download off to the host](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/desktop-update-handoff.gif)

## Downloads

[![Daily npm downloads trend](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-update.svg)](https://www.npmjs.com/package/@klarkxy/dsh-update)

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-update
```

Replace `web` with your profile name and restart the profile after installing.

## Usage

All update checks are read-only; confirming in a modal asks the host to approve the write, and nothing is installed or upgraded unless the host approves:

1. **Preview and confirm DSH core updates**:
   - Clicking the sidebar **New version** pill opens a changelog modal showing every Release log between the running DSH build and the target release instead of starting an immediate download (with a toggle between active-language excerpts and full notes when bilingual notes are available), or check from **Plugins → Updates**.
   - Click **Download & Update** in the modal to hand the download off to the host's own update button; dismissing the modal leaves the running installation untouched.
2. **Preview and confirm plugin updates**:
   - Open **Plugins → Updates** to check all installed third-party plugins (both npm registry and Git-installed plugins) at once, or click **Check updates / View update** in any third-party plugin's detail header.
   - Review the Release logs and click **Update & Apply**. The host installs and hot-reloads the target only after it approves (or asks you to restart when the profile has no HMR); a rejected or unavailable host confirmation leaves the installed plugin as it is.

## Limitations

- **Relies on GitHub Releases metadata**: Changelogs are read from GitHub Releases of the repository declared by DSH or each plugin; if a plugin omits repository metadata or publishes versions without GitHub Releases, the modal notes that no Release logs were found in range and links to the repository.
- **Writes require host approval**: The confirmation button in the page cannot authorize an install by itself. When the host provides no confirmation, the update is refused and neither the plugin manager nor a global install runs.
- **Local linked plugins stay local**: Plugins mounted via `link:` or `file:` are not overwritten online; rebuild them in their local checkout instead.
- **Anonymous GitHub API rate limits**: When neither an authenticated `gh` CLI nor `GITHUB_TOKEN` is present on the host, requests use unauthenticated GitHub REST calls and share GitHub's anonymous rate limit.

## License

[SATA License 2.1](LICENSE)
