# Plugin manager and live inspection

[中文](../zh/areas/plugin-manager-inspect.md)

Change the current profile with the `plugin_manager` tool or `dsh plugin`. Do not hand-edit the profile `package.json`. Look up signatures of mounted services with `cordis_inspect_query`. Both tools require `danger-full-access` or a one-time approval.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh-plugin-manager` manages the current profile: list and toggle plugin rows, list and toggle bundles, install and remove bundles through pnpm, and record exact-version compatibility exemptions. The Web sidebar and the `plugin_manager` tool share that service.

`@deepseek-ai/dsh-tool-cordis` is the model-facing inspection surface for a running composition. It does not install packages.

## Where it lives

- Manager: [packages/boot/plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md)
- Tool parameters: [packages/boot/plugin-manager/src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/src/tools.ts)
- Extensions group: [packages/extensions/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/README.md)
- Inspect tools: [packages/extensions/tool-cordis/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/README.md)
- Dynamic Cordis practice: [docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)

The base patch ships `plugin-manager` and leaves `tool-plugin-manager` disabled until a profile enables it. The cordis-plugin-development skill says the row id and the reason are in the shipped patch.

## Contract

`plugin_manager` `action` values from the tool schema:

| Action | Role |
| --- | --- |
| `list_plugins` | Page plugin rows. |
| `list_bundles` | Page bundles. |
| `set_plugin` | Enable or disable one row. |
| `set_bundle` | Enable or disable one bundle. |
| `install_bundle` | Install a package and select its bundle. |
| `remove_bundle` | Remove a bundle. |
| `list_version_exemptions` | Show the runtime version and saved grants. |
| `set_version_exemption` | Grant or revoke an exact `package@version` for an exact DSH runtime. Granting requires `acceptRisk: true`. |

Other parameters: `target`, `enabled`, `runtimeVersion`, `acceptRisk`, `approvedBuilds`, `registry`, `offset`, `limit`. List pages default to offset 0 and limit 25, with limit from 1 to 100.

Every action goes through an approval escalation whose requested mode is `danger-full-access`. The justification states that profile changes persist and installed host code runs outside the workspace sandbox. Pass `approvedBuilds` only after the user approves those install scripts. The service records the names; it does not check the conversation.

Service methods behind the tool include `listPlugins`, `listBundles`, `setPluginEnabled`, `setBundleEnabled`, `installBundle`, `removeBundle`, `inspect`, `listVersionExemptions`, `setVersionExemption`, `waitForInstall`, and `cancelInstall`. Events include `plugin-manager/changed`, `plugin-manager/install-log`, and `plugin-manager/install-state`.

Documented manager config defaults include `pnpmCommand` `pnpm`, `inspectTimeoutMs` 20000, `githubConnectionTimeoutMs` 5000, `fallbackRegistries` `['https://registry.npmmirror.com/']`, `outputBytes` 16384, `lockWaitMs` 120000, and `idleTimeoutMs` 600000 for service runs. CLI runs that inherit a terminal are not bound by `idleTimeoutMs`.

Activation results distinguish `applied`, `restart-required`, `failed`, and `overridden`. Replacing an installed package requires a process restart to load a new JavaScript module generation. HMR can apply a newly installed bundle. The manager cannot disable its own management components, change another profile, or edit an agent preset's composition.

Inspection tools documented by the extensions group are `cordis_inspect_list` and `cordis_inspect_query`. The plugin-development skill tells agents to query `Service`, `Event`, `Config.listConfigs`, `Tool`, `Slots`, and `Theme` before writing a plugin. `Config.listConfigs` filtered by package `name` yields an `entry` id; querying that entry returns `packageDir`, which is where `README.md` and `lib/types` live. `ctx.cordisInspect` and `ctx.dynamicCordisRunner` come from `cordis-host-runner`.

## How a plugin author uses it

- Install your bundle with `install_bundle` and the absolute package directory, or with `dsh plugin --profile <name> add`. Do not write `$DSH_HOME/profiles/<name>/package.json` yourself.
- After `application: applied`, confirm the row with `cordis_inspect_query` rather than assuming the patch text is live.
- Read `<packageDir>/README.md` before reading `src/` in a checkout. Installed packages ship `lib/`, not `src/`.
- A dynamic mount is for a live experiment. A bundle patch is what survives restart. The practice guide owns the dynamic path.

## Sources

- [packages/boot/plugin-manager/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/README.md)
- [packages/boot/plugin-manager/src/tools.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/plugin-manager/src/tools.ts)
- [packages/extensions/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/README.md)
- [packages/extensions/tool-cordis/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/extensions/tool-cordis/README.md)
- [docs/user/develop/practice/dynamic-cordis.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/practice/dynamic-cordis.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
