# DSH Blueprint

[中文](README.zh-CN.md)

Export and import DSH plugin compositions from the **official Plugins page**. Share either the plugin list and layer order, or the same composition with saved configuration. No Spaces installation, workspace supervisor, separate desktop application or cloud account is required.

**Source preview, not a published or end-to-end-certified release.** See [ACCEPTANCE.md](ACCEPTANCE.md) for actual test coverage and outstanding runtime verification.

## Install this checkout

Requires a DSH Web host exposing the official `pluginManager`, profile-backed volatile `settings`, `pluginPackages`, `loader`, authenticated `connection.rpc` and plugin-manager configuration slots. The adapter checks capabilities instead of assuming a version string guarantees support. The current source contracts were reviewed at upstream commit `477b4f420553e8a52c2fbccc464d7561b239c443`; compatibility with a particular npm/desktop release still needs a runtime test.

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

Open **Plugins → DSH Blueprint**. A **Share blueprint** action on another bundle's detail page opens the same export screen focused on that bundle.

Select bundles, choose **Plugins only** or **Include saved settings**, and generate a preview. Settings mode also records editable plugin-row enabled states. Ordinary fields are included by default. Uncheck a form or individual field before generating. Copy the share code or save UTF-8 JSON. Nothing is published or sent to a third-party service.

On the receiving host, paste a code/JSON or open a file, then **Preview import changes**. Inspect versions, operations, the resulting complete layer order, settings values and warnings. Confirm the trust notice before applying. Missing packages are installed disabled through the official manager; requested bundle activation is an explicit, previewed operation and executes plugin code.

When composition changes are needed, apply those first, then run **Preview settings after installation**. This second preview binds configuration writes to the real installed plugin's native schema and revision. The plugin never invents configuration metadata for code that has not been loaded. Native `restart-required`, rejected writes or failures stop the plan and are reported rather than called success.

## Scope and defaults

- Only bundles listed by the official manager are selected. Exact npm versions and installation-provided bundles are supported. Local links, git/tarball sources, aliases, unreadable metadata and version conflicts are reported, not silently rewritten as npm packages. Dependencies without a bundle remain the native package manager's responsibility.
- The native manifest supplies layer order, not the alphabetically sorted cards. Unshared bundles are not removed or disabled. If relative order must change, selected active bundles are disabled and then enabled in blueprint order, after unshared layers. The preview shows this placement and every resulting operation. A bundle with no activation change is not cycled unnecessarily.
- Settings come exclusively from the official Config/Settings **native editable descriptors**: saved effective values, including defaults, not browser drafts, raw Config files or plugin data directories. No page ledger or per-page mapping is maintained. Custom UI over native Settings works without UI-specific handling; custom-only pages, APIs and storage are deliberately unsupported.
- Only active, uniquely owned, writable native forms are eligible. Ordinary nonvolatile fields are not shared. Unavailable native settings are reported; package-list sharing remains available. An incoming unsupported form or path blocks the settings preview instead of being silently dropped. A custom page may display fewer fields than the native descriptor: review the actual export fields, not the page's appearance.
- See [Settings scope](SETTINGS-SCOPE.md) for the normative boundary, author responsibilities, alpha.1 behavior change and upstream evidence. There is no planned per-plugin custom-storage adapter or migration layer.
- Host-redacted secrets never enter the blueprint. A secret-bearing array is omitted as a whole rather than reindexed or copied incompletely. The plugin does not read the credential service. **Unmarked private text is not reliably recognizable as a secret.** Preview the output before publishing it.
- Import applies explicit field edits with the native revision check, preserving unmentioned values. It is not a whole-form replacement. Nonsecret arrays are replaced atomically; they are not guessed or merged by index. Connection-target changes (`baseURL`, `endpoint`, `url`, `host`, `apiKeyEnv` and spelling variants) require local changes in the official page before importing, even when the secret lives outside the Settings form. This avoids silently combining an imported endpoint with a receiver's existing key.
- Native type/schema validation still applies. Directory strings and provider/model route names are ordinary settings, not copied resources; the recipient must ensure they refer to available local resources. Import does not transfer directories, model connections, keys, sessions, attachments, histories, databases or caches.

## Optional author policy

No contribution means **include the native public form by default**. In the owning package's `package.json`, an author can narrow sharing for an exact native row id:

```json
{
  "dshBlueprint": {
    "version": 1,
    "entries": {
      "my-plugin": {
        "exclude": [["privateNote"], ["connection", "machineId"]]
      },
      "another-instance": { "share": false },
      "theme": { "include": [["appearance"]] }
    }
  }
}
```

Paths are arrays of exact segments, not globs or JavaScript. `share: false` excludes the entire form; `include` narrows it; `exclude`, native editability and host secret annotations always win. The receiver rechecks its installed policy. Invalid declarations make that package's configuration unavailable with a warning; they never degrade to exporting everything. Metadata is read as JSON without executing export callbacks. This policy only narrows native fields; it cannot register another storage source. This is this plugin's contribution contract, not an official DSH manifest extension.

## Portable format v2

```json
{
  "kind": "dsh-blueprint",
  "formatVersion": 2,
  "metadata": { "name": "My setup", "version": "1.0.0" },
  "packages": [
    { "name": "example-plugin", "version": "1.2.3", "source": "npm" }
  ],
  "bundles": ["example-plugin"],
  "settings": [
    {
      "package": "example-plugin",
      "row": "example",
      "module": "example-plugin",
      "fields": [{ "path": ["theme"], "value": "paper" }]
    }
  ]
}
```

The package is illustrative, not an install recommendation. `settings` and `rows` are optional; plugin-only exports omit both. `rows` entries carry `package`, `row`, `module` and boolean `enabled`. `source` is `npm` or `builtin`. Exact row/module/package identity is verified on the recipient. Unknown root/entry fields and unsupported versions are rejected.

Codes are `DSHBP2:J:<unpadded-base64url-UTF8-JSON>` or `DSHBP2:Z:<unpadded-base64url-raw-DEFLATE-JSON>`. The encoder chooses the shorter form. Limits: 1 MiB decoded JSON, 2 MiB input code, 64 JSON container levels. Duplicate JSON members, unsafe numbers, prototype keys, malformed Unicode, noncanonical Base64url and trailing compressed streams are rejected. Codes are **not encryption, signatures or proof of trust**.

Spaces `DSHBP1` / format v1 described creation of a new isolated space, including Spaces-specific bindings. The v2 reader rejects those codes rather than silently applying them to the current profile. Re-export through the new manager integration. This extraction does not delete or rewrite the legacy v1 implementation in the source repository; no in-place v1 migration is claimed.

## Operation and security contract

All management goes through the official manager; all setting writes go through native Settings. The package registers an authenticated logical RPC channel through official Connection, not a second server. The native transport's request cap also applies.

A preview creates a process-local, five-minute, one-use plan bound to the observed profile and form revisions. At most eight plans/results are retained. Changed observations invalidate a plan; completed results can be read without rerunning operations. No automatic retries, upgrades, downgrades, script approvals, removals, cross-profile writes or blueprint-level rollback are performed. The native installer retains its own documented failure behavior.

A multi-step import is **not a transaction or a lock against every other editor**. It checks observed state between operations and uses native per-operation serialization/revision checks. Stop editing that profile elsewhere while applying. Failures preserve visible partial outcomes; a lost response is not a reason to replay an import. Closing the page requests cancellation where supported. Already-completed changes may remain.

## Development

`npm test` runs dependency-free unit, adapter-contract and client-registration tests. `npm run build` checks JavaScript syntax; it is not a TypeScript or native integration check. `npm pack --dry-run` checks distribution contents. No test uses the real DSH home.

MIT. The extracted codec's original copyright is retained; see [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
