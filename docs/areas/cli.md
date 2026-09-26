# CLI

[中文](../zh/areas/cli.md)

`dsh` is the only supported Node launcher. `dsh plugin --profile <name>` forwards its arguments to pnpm in that profile directory. `--dump-config` prints the composed result and does not boot the application.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

`@deepseek-ai/dsh` parses launcher flags, stacks profile bundle patches, then either boots that tree, dumps configuration, or forwards `dsh plugin` to pnpm. SDK and ACP are profiles, not separate public binaries. Unrecognized tokens become `ctx.cmdlineArgs` for the booted app.

## Where it lives

- Command table: [apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/README.md)
- Flags, layers, schema dump: [apps/cli/reference/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/reference/README.md)
- Flag parser: [apps/cli/src/args.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/args.ts)
- Plugin subcommands: [apps/cli/src/plugin.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/plugin.ts)
- App-owned argv: [packages/boot/cmdline/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/cmdline/README.md)

## Contract

| Command | Purpose |
| --- | --- |
| `dsh <name>` / `dsh --profile <name>` | Boot `$DSH_HOME/profiles/<name>`. |
| `dsh --profile <name> --from-default-profile <template>` | Create a custom profile from a shipped template, then boot it. |
| `dsh web` | Boot the Web profile. Shorthand for `--profile web`. |
| `dsh --profile headless "job"` | One persisted session, print the final answer, exit. |
| `dsh --profile sdk` | SDK JSON-RPC stdio. |
| `dsh --profile sdk-minimal` | Minimal agent tree over the same protocol. |
| `dsh --profile acp` | ACP stdio until disconnect. |
| `dsh plugin --profile <name> <pnpm args>` | pnpm in the profile directory. |

Profiles that auto-initialize on first use: `web`, `headless`, `sdk`, `sdk-minimal`, `acp`. Those names are also the valid `--from-default-profile` templates. The name `desktop` is reserved and rejected. `dsh plugin` is the package manager, not a profile boot. To boot a profile literally named `plugin`, use `dsh --profile plugin`.

Launcher flags include `--profile`, `--from-default-profile`, repeatable `--patch`, `--dump-config`, `--dump-default-config`, `--dump-config-schema`, and `-V` / `--version`. Dump flags are mutually exclusive and reject app arguments.

App arguments are not another patch layer. The Web profile accepts `--host`, `--port`, repeatable `--trusted-host`, and `--no-open`. Headless takes the task as a positional argument. A bundle that wants its own flags exports a plugin with `inject = ['cmdlineArgs']` and calls `parseCmdline` from `@deepseek-ai/dsh-cmdline`.

`dsh plugin` forwards ordinary pnpm verbs (`add`, `remove`, `update`, `why`, …) after reconciling `dsh.profile.bundles` with packages that declare `dsh.bundle`. It also owns:

- `dsh plugin --profile <profile> version-exemptions`
- `dsh plugin --profile <profile> allow-version <package@version> --dsh-version <runtime> --accept-risk`
- `dsh plugin --profile <profile> revoke-version <package@version> --dsh-version <runtime>`

Before a profile imports a plugin, DSH checks `peerDependencies` on `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` against the single runtime version from `getDshRuntimeVersion()`. Every declared range must match. Prereleases participate. Missing DSH peers impose no constraint. An incompatible bundle without an exact exemption in the profile's `compatibility.json` is skipped and listed in `skippedBundles`. `--dump-config` still shows a denied plugin row when the row itself is configured, while a denied bundle contributes no rows.

Git installs fetch sources. The publish tutorial requires a `prepare` script that builds entry points without assuming a monorepo. pnpm blocks that script until the user allowlists it. The CLI tells the user to add the exact key pnpm printed under `allowBuilds` in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-hello-plugin: true
```

That allowance executes package code on the machine at install time. Pin a commit (`github:you/plugin#<sha>`) when the source must not move. A subdirectory selector uses `#path:` as documented for git hosts; combine a commit and a path only on platforms whose shell does not swallow `&`.

From a source checkout, `pnpm run build` then `pnpm dsh <args...>` runs the TypeScript entry.

## How a plugin author uses it

```sh
dsh plugin --profile web add ./your-bundle
dsh --profile web --dump-config
```

Install from git with `dsh plugin --profile web add github:you/repo`. If pnpm refuses the build, copy the printed `allowBuilds` key and run the add again. Publish to npm or `pnpm pack` a tarball when you do not want users to allow a build script.

Do not hand-edit the profile `package.json` bundles list when `dsh plugin` or `plugin_manager` can do it. Those writers share the profile lock.

A surface bundle reads app flags through `ctx.cmdlineArgs` inside its own startup plugin. It does not add launcher flags.

## Sources

- [apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/README.md)
- [apps/cli/reference/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/reference/README.md)
- [apps/cli/src/args.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/args.ts)
- [apps/cli/src/plugin.ts](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/apps/cli/src/plugin.ts)
- [packages/boot/cmdline/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/cmdline/README.md)
- [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)
- [packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
