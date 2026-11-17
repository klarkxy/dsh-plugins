# Secret Manager

<!-- release-state-note -->

[简体中文](README.md) / English

Collect and manage secrets outside chat. When the agent needs an API key or token, it asks through a dedicated dialog: your input goes straight to the local Host without entering the conversation, the model only sees a `secret://<slot>` reference, and usage is granted per session for shell environment variables or exact HTTPS origins.

## Install

This package is currently under local development and not yet published to npm. Build it from a repository checkout and install from the local path:

```sh
pnpm --filter @klarkxy/dsh-secret-manager build
dsh plugin --profile web add ./plugins/dsh-secret-manager
```

Replace `web` with your profile name, then restart the profile or reload the page. Once published to npm, the same command works with the scoped package name `@klarkxy/dsh-secret-manager`.

## Usage

### Model Tools

| Tool | Purpose | Output |
| --- | --- | --- |
| `request_secret` | Opens a dedicated dialog to store or reuse a secret and optionally grant session permissions | Returns only status, `secret://<slot>` reference, `DSH_SECRET_*` name, and grant flags |
| `secret_status` | Checks which `secret://<slot>` references are configured | Returns configured references and derived env var names only, never values |
| `secret_http` | Sends an HTTPS request to a session-approved exact `https://` origin with the auth header attached | Returns status and response body (omits response headers; masks the secret in body text) |

### Answering a Request (`request_secret` Modal)

When the model calls `request_secret`, a dedicated authorization modal opens automatically in the conversation, showing the slot name, `secret://<slot>` reference, `DSH_SECRET_*` environment variable name, purpose, optional target, and expiration time:

- **Enter or reuse**: type or paste the secret into the masked input field, or leave it empty to reuse the value already saved under that slot.
- **Choose per-session permissions**: shell and HTTP permissions are granted separately and apply only to the current session:
  - **Shell environment (`DSH_SECRET_*`)**: when requested, allows this session’s non-persistent shell calls to receive the derived `DSH_SECRET_*` variable (for example, `github-token` maps to `DSH_SECRET_GITHUB_TOKEN`).
  - **Exact HTTPS origin**: when requested, allows this session to send the secret via `secret_http` to the exact `https://` origin displayed, using the shown authentication header and prefix (`Authorization: Bearer` by default, or another header/prefix specified in the request and approved by you).
  - If neither permission is checked, saving stores the secret without granting session access yet.
- **Decline and reopen**: clicking **Decline request** or closing the modal rejects the request and clears the input field immediately. If the decline fails to reach the Host, an error with **Retry** stays visible rather than pretending the request was cancelled. While pending, the chat tool row shows “Waiting for your secret” with an **Open authorization** button to reopen the dialog.

### Managing Secrets and Session Grants (Settings → Secrets)

Open **Settings → Secrets** (the Secret Manager settings section):

- **Secrets**: enter a slot name (lowercase letters, digits, and inner hyphens) and a masked value to save (an existing slot name overwrites), or use **Replace** and **Delete** behind confirmation dialogs. Stored values are always masked and never echoed back or shown as partial tails.
- **This session’s grants**: inspect shell and HTTP permissions held by the currently open session and active session counts per slot, and click **Revoke this session’s grant** or **Revoke every session’s grant** to withdraw access without deleting the secret itself.

## Limitations

- **Local plaintext storage**: secrets are persisted locally through the Host credential store **in plaintext**—this is a reference manager, not an encrypted vault. Anyone able to read your DSH data directory can read stored values.
- **Input isolation vs. redaction boundaries**: dialog submissions go straight to the Host and clear immediately on submit, decline, or close without entering chat history, persistent browser storage, or plugin logs. Post-execute redaction covers normal committed tool results, **not** live streaming shell output, spilled temp files, encoded or transformed rewrites (such as Base64/Hex), or external logs. Any shell command running in a granted session can read its granted `DSH_SECRET_*` variables, so grant shell access deliberately.
- **Strict session and lifetime bounds**: grants apply only to the top-level session that approved them—they are **not** inherited by delegated subagents, expire after about an hour, and are cleared on plugin unload or Host restart. Replacing or deleting a secret immediately revokes all grants for that slot, and unanswered `request_secret` dialogs expire after 5 minutes.
- **Shell and HTTP scope boundaries**: shell injection works only in native non-persistent shells (persistent shells are not supported). `secret_http` accepts only exact `https://` origins (no domain wildcards, plain HTTP, embedded URL credentials, or HTTP redirects) and enforces response size limits.
- **No transparent rewriting or auto-granting**: arguments to other tools that already contain raw secrets are never rewritten automatically; the model can only ask, and every save, grant, replacement, or revocation requires explicit user action.

## License

[SATA License 2.1](LICENSE)
