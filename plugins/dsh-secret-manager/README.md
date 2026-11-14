# Secret Manager

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Collect secrets outside the chat. When the agent needs an API key or token it asks through a dedicated prompt window: the value goes straight to the local Host, the value never enters the conversation, and the tool only receives a `secret://<slot>` reference. Use is permissioned per session — for the session's own shell calls and for exact HTTPS origins.

## Install

The package is in draft and not on npm yet. Install the development build from a checkout of this repository:

```sh
dsh plugin --profile web add ./plugins/dsh-secret-manager
```

Replace `web` with your profile name and restart DSH Web. Once it is published, the same command works with the scoped package name `@klarkxy/dsh-secret-manager`.

## Use

### Answer an agent request

When the model calls `request_secret`, the prompt window opens on its own in the conversation:

- Enter the value in the masked field, or leave it empty to reuse the value already stored under that slot.
- Tick which use to allow for **this session**: shell use (`DSH_SECRET_*` environment variable) and/or sending the secret to the exact HTTPS origin shown with the authentication header shown (by default `Authorization: Bearer`, unless the agent asked for another header/prefix you approve).
- **Decline request** rejects this request; closing the dialog does the same, so a request never hangs unanswered. If the decline cannot reach the Host, the dialog shows an error and you can retry — you are never told a request was cancelled when it was not. The field clears the moment you submit or close.

While the request is open, its chat row shows "Waiting for your secret" with an **Open authorization** button to bring the dialog back. The tool result carries only status — granted scopes and the `secret://` reference — never the value.

### Manage secrets

Open **Settings → Secret Manager** (密钥管理器):

- **Secrets**: add a name and value (same name overwrites), replace a value behind a confirmation dialog, or delete. Values are masked, never shown back and never carry a tail.
- **This session's grants**: for the currently open session, revoke its grant for a secret — or revoke every session's grant — without deleting the value.

Shell use and HTTP sending are granted separately. A grant is bounded to the current session and expires; nothing is granted to all sessions by default.

## Limits

- The dialog submits the value directly to the Host. Save and authorization tool results contain only references and status, never the value. The plugin does not write submitted values to persistent browser storage or its own logs.
- Values are stored locally in plaintext — this is a reference manager, not an encrypted vault. Anyone who can read your DSH data directory can read them.
- Grants are bound to the current session: they expire after about an hour, are cleared when the plugin unloads or the Host restarts, and replacing or deleting a value revokes every grant for it immediately. They are not inherited by subagents, and every pending request expires after a few minutes if unanswered.
- Shell use targets the native non-persistent shell. Persistent shells are not supported.
- HTTP use is exact-origin only: the secret is attached with the authentication header you approved toward the shown `https://` origin — `Authorization: Bearer` unless the request asked for another header/prefix — never to a whole domain or wildcard.
- Redaction covers the entry channel and normal tool results, not streamed output, spilled files, encoded rewrites or external logs — a session's own shell can also read its granted `DSH_SECRET_*` variables, so scope them deliberately.
- There is no transparent whole-tool replacement: tools that already hold a raw secret in their arguments are not rewritten automatically.
- No automatic granting: the agent may ask, but every save, grant, replacement and revocation is an explicit user action.

## License

[SATA License 2.1](LICENSE)
