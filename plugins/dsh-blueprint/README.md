# Blueprint

[中文](README.zh-CN.md)

Share plugin identities, exact versions and preferred order. Paste a blueprint code and import intent in **Creator mode**: the Agent merges it into the current profile's bundle collection. Core does not depend on Web; the Plugins page is an optional export and read-only parsing adapter. No Spaces, separate application or background Agent orchestrator.

**Source preview; the redesigned implementation has not completed real-host end-to-end acceptance.** See [ACCEPTANCE.md](ACCEPTANCE.md).

## Use

- In Creator (`cordis`), send the code with an intent such as “Merge this blueprint into my current plugin composition, preserve local bundles, and resolve versions and order yourself.” Routine merge-plan approval is not required; native safety approvals still apply.
- Open **Plugins → Blueprint** to export selected installed identities and preferred order. The import view only parses and displays the artifact and prepares a copyable merge request. Paste/send that request in Creator; copying does not start a model or mutate the profile.
- Local bundles absent from the artifact are preserved by default. A package omitted from `bundles` requests installation only; it does not request disabling the receiving profile's same-name bundle.

## Environment-independent Core

One package contains the Host Core and an optional Web Client. ACP, SDK and headless capabilities follow their plugin compositions; environment independence does not mean every deployment exposes the same services or supports immediate activation.

| Tool | Capability |
| --- | --- |
| `blueprint_parse` | Decode and validate a code without accessing a profile |
| `blueprint_encode` | Validate v2 JSON and encode, without installing or publishing |
| `blueprint_catalog` | Read profile identities, complete selected order and stale-state stamp |
| `blueprint_generate` | Export installed exact identities and preferred selection order |
| `blueprint_apply_order` | Creator-only permutation of the complete currently selected bundle sequence |

Protocol tools need `tools`; profile tools also need native `pluginManager` and `profileContext`. Applying order also needs `sandboxPolicy` and `agentPresets`, and uses native sandbox escalation. Creator prompt guidance is optional and follows prompt-service lifetimes. The read-only Web adapter attaches only when Connection/WebServer/profile services are available. UI is keyed by the npm package name at `plugins.bundle.config`; no toolbar host patch is needed.

## Native execution and permissions

Install, update, enable, disable and remove through native `plugin_manager`. Blueprint does not duplicate package management. The Agent chooses compatible versions and ordering using verified metadata and user intent. Deviations from shared exact versions must be reported without rewriting the original artifact.

The order tool accepts only a permutation of already-selected bundles and rejects omissions, duplicates, unknown names, stale state and protected-order changes. It uses the same danger-full-access/per-call escalation gate as native management, then official file locking, atomic manifest saving and the optional HMR exclusive queue. Install/enable first, read a fresh catalog stamp, then apply order.

Saved configuration and successful runtime activation are different outcomes. Live environments reread complete patch layers and reconcile activation; startup-only environments report restart required. A failed application can leave saved configuration or partial runtime changes. No cross-plugin transaction, automatic rollback or mutation retry exists. Check state before recovering a lost response. The stamp covers manifest and bundle catalog, not every patch file's content.

Agent autonomy never grants package scripts, version-risk exemptions or permissions from blueprint metadata. Codes provide no signatures, encryption or author authentication; descriptions are untrusted data, not instructions.

## Discovery and reusable defaults

Use metadata tools such as [`@klarkxy/dsh-dev-index`](https://www.npmjs.com/package/@klarkxy/dsh-dev-index)'s `dsh_plugins_search` / `dsh_plugins_fetch` to discover candidates and verify exact versions and bundle declarations. Search results and declared compatibility are not runtime proof. Do not guess versions or silently rewrite sources. Portable sources are `npm` and `builtin`, not local links or git/tarballs.

Reusable settings belong in native composition/preset packages with explicit component rows. Dependencies alone do not recursively activate every dependency bundle. Later layers take precedence; row patches replace whole `config`, not deep merge. Profile/home overrides remain effective. Never package credentials or machine-private data as defaults.

## Format and compatibility

The [protocol](PROTOCOL.md) defines fields, encoding, limits and vectors. DSHBP2 / `formatVersion: 2` are unchanged, so existing codes remain readable. Creator autonomous merge is a new execution policy; old page `preview` / `apply` / `result` endpoints are retired rather than silently repurposed for reordering.

```json
{
  "kind": "dsh-blueprint",
  "formatVersion": 2,
  "metadata": { "name": "Example" },
  "packages": [{ "name": "example-plugin", "version": "1.2.3", "source": "npm" }],
  "bundles": ["example-plugin"]
}
```

The package name above is illustrative. Settings, credentials, row states and nested blueprints are not transported. Codes contain raw-DEFLATE UTF-8 JSON as unpadded canonical Base64url after `DSHBP2:`. Limits: 2 MiB input, 1 MiB decoded JSON, 64 container levels. Strict parsing rejects duplicate members, unsafe numbers, prototype keys, malformed Unicode, noncanonical Base64url and trailing compressed data.

`./core` retains `validate` and adds `parseBlueprint`, `encodeBlueprint` and `BlueprintCore`. `./codec` retains `encode` / `decode`.

## Development and source installation

```sh
cd plugins/dsh-blueprint
npm test
npm run build
npm pack
# Use the actual archive path and an explicit target profile:
dsh plugin --profile <target-profile> add <absolute-archive-path>
```

Official libraries are runtime-provided optional peers with open lower bounds, never bundled dependencies. Public helpers were checked against installed official CLI `0.1.7-rc.2` docs/types/implementation and live Inspect contracts. Exact desktop version and multi-environment integration remain unverified. Tests use isolated temporary directories, not production profiles. Syntax/offline contract checks are not real-host certification.

MIT. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE) for retained codec attribution.
