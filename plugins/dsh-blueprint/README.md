# Blueprint

[中文](README.zh-CN.md)

Export and import DSH plugin compositions from the **official Plugins page**. Blueprint codes share only the plugin list, exact versions and order. Reusable default configuration belongs in native composition/preset plugins. No Spaces installation, workspace supervisor, separate desktop application or cloud account is required.

**Source preview, not a published or end-to-end-certified release.** See [ACCEPTANCE.md](ACCEPTANCE.md) for actual test coverage and outstanding runtime verification.

## Install this checkout

Requires a DSH Web host exposing the official `pluginManager`, `profileContext`, authenticated Connection/WebServer and plugin-manager configuration slots. The adapter checks capabilities instead of assuming a version string guarantees support. The current source contracts were reviewed at upstream commit `477b4f420553e8a52c2fbccc464d7561b239c443`; compatibility with a particular npm/desktop release still needs a runtime test.

```sh
cd plugins/dsh-blueprint
npm test
npm run build
npm pack
# Use the tarball path printed by npm pack, and your intended profile:
dsh plugin --profile <target-profile> add /absolute/path/to/klarkxy-dsh-blueprint-0.1.0-alpha.2.tgz
```

This package has no npm dependencies and no compilation requirement. It calls native host services and uses the host's React runtime. Do not copy a standalone React or another Cordis instance into the host.

## Use

On hosts with the `plugins.list.actions` slot, use **Plugins → Blueprint → Import blueprint / Export blueprint** in the list toolbar. The Blueprint plugin page offers the same controls on hosts without that slot. Other plugin detail pages no longer show a Share blueprint button.

**Export blueprint:** select plugins, review or adjust their preferred order, generate a code and copy it. Paste it into **Import blueprint**, preview package operations and final order, then confirm. Missing packages are installed disabled through the official manager before explicit activation; unrelated packages are preserved. No configuration or row states enter a blueprint.

The official DSH 0.1.7-rc.2 host lacks the list-toolbar slot. See the source patch in [host integration](https://github.com/klarkxy/dsh-plugins/tree/main/host-integration/blueprint-list-actions). Shipping this plugin alone cannot add a toolbar control to the stock host.


## Creator mode

When this plugin is loaded, Creator (`cordis`) receives the bundled [blueprint skill](skills/dsh-blueprint/SKILL.md), covering blueprint codes, import previews and native composition plugins. The body is injected directly into the Creator system prompt so it does not depend on a skill catalog or a separate skill tool. Other presets receive no guidance; switching away removes it on the next prompt assembly. Registration follows plugin and prompt-service lifetimes. Hosts without prompt services retain the Plugins-page workflow.

The skill uses the read-only discovery tools below and the existing page and validation/codec exports. It adds no model-facing install/apply tools and does not imply permission to import or publish a blueprint. Without page access, the agent can prepare/review JSON and explain the remaining steps, but must not claim the import ran.

## Plugin search and versions

Blueprint owns two read-only host tools (subject to the host's tool policies); it does not depend on the official-documentation plugin:

- `blueprint_search_plugins({ query, source?, limit?, offset? })`: the default `catalog` source searches the site's published Chinese/English [plugin catalog](https://klarkxy.github.io/dsh-plugins/plugins.json). `source: "npm"` searches npm's `dsh-plugin` keyword candidates and filters for DSH names/keywords. Neither source is exhaustive; use exact package lookup for known packages. Results include source, fetch time and pagination, and remain candidates until version verification.
- `blueprint_plugin_versions({ package, version?, limit?, offset? })`: queries public npm metadata, lists published releases and tags, and returns the selected exact version's bundle declaration, DSH/Node engine ranges, dependencies, peer dependencies and deprecation. `version` accepts an exact release or dist-tag, defaulting to `latest`; ranges are rejected. Versions are paged by publication time, not semver precedence. Use `selected.version` in the blueprint.

Queries fetch current metadata without caching or a stale fallback. They do not download packages, execute scripts, install plugins or alter the profile. Native import preview remains the authority for installation and target compatibility. Built-in bundles still come from the current host; these tools do not discover private registry packages. Missing tool services leave the page operational; plugin/service unload unregisters tools and aborts pending requests. Tool registration uses the DSH 0.1.7-rc.2 output contract.

## Scope and defaults

- Only bundles listed by the official manager are selected. Exact npm versions and installation-provided bundles are supported. Local links, git/tarball sources, aliases, unreadable metadata and version conflicts are reported, not silently rewritten as npm packages. Dependencies without a bundle remain the native package manager's responsibility.
- Export starts from native order and records a preference. Import preserves the full local active sequence and appends only requested activations that are not already active. Matching packages are reused; omitted or install-only entries never disable local bundles. Different sequence order is not a conflict, and repeating an unchanged import is a no-op.
- Blueprint does not read or write settings, schemas, credentials or plugin data. There is no settings-transfer or field-sharing policy.

## Reuse configuration through composition plugins

A native bundle can depend on plugin packages and explicitly insert their components with reusable configuration defaults in its cordis.patch.yml. Another bundle can override existing rows. Dependency installation alone does not recursively activate every dependency bundle; declare the intended component rows and avoid loading the same row twice.

This uses the host's existing configuration layers. Later layers take precedence, and a row patch replaces the entire config value rather than deep-merging its fields. Users' profile/home overrides can supersede bundle defaults. Do not package keys, credentials or machine-specific personal data as reusable defaults. See the [version-matched official bundle guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/docs/user/develop/basic/publish.md#the-loading-order).

Enabling a bundle can change the effective defaults contributed by its own patch. The newly appended layer still participates in native configuration precedence; review the package operation preview.
## Portable format v2

See the [blueprint-code protocol](PROTOCOL.md) for the complete fields, additive import semantics, encoding rules and shipped test vectors.

```json
{
  "kind": "dsh-blueprint",
  "formatVersion": 2,
  "metadata": { "name": "My setup" },
  "packages": [
    { "name": "example-plugin", "version": "1.2.3", "source": "npm" }
  ],
  "bundles": ["example-plugin"]
}
```

The package is illustrative, not an install recommendation. `source` is `npm` or `builtin`. Blueprint documents contain only the fields shown above; unknown fields and other document kinds are rejected.

Codes use one format: `DSHBP2:<payload>`, where the payload is unpadded canonical Base64url of raw-DEFLATE-compressed UTF-8 JSON. The interface imports and exports only this code; JSON is an internal data structure. Limits: 1 MiB decoded JSON, 2 MiB input code, 64 JSON container levels. Duplicate JSON members, unsafe numbers, prototype keys, malformed Unicode, noncanonical Base64url and trailing compressed streams are rejected. Codes are **not encryption, signatures or proof of trust**.

## Operation and security contract

All package management goes through the official manager. The package registers an authenticated logical RPC channel through official Connection, not a second server. The native transport's request cap also applies.

A preview creates a process-local, five-minute, one-use plan bound to the observed package/profile state. At most eight plans/results are retained. Changed observations invalidate a plan; completed results can be read without rerunning operations. No automatic retries, upgrades, downgrades, script approvals, removals, cross-profile writes or blueprint-level rollback are performed. The native installer retains its own documented failure behavior.

A multi-step import is **not a transaction or a lock against every other editor**. It checks observed state between operations and uses native per-operation serialization. Stop editing that profile elsewhere while applying. Failures preserve visible partial outcomes; a lost response is not a reason to replay an import. Closing the page requests cancellation where supported. Already-completed changes may remain.

## Development

`npm test` runs dependency-free unit, adapter-contract and client-registration tests. `npm run build` checks JavaScript syntax; it is not a TypeScript or native integration check. `npm pack --dry-run` checks distribution contents. No test uses the real DSH home.

MIT. The extracted codec's original copyright is retained; see [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
