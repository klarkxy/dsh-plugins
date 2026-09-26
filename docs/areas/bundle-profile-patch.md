# Bundles, profiles, and patches

[中文](../zh/areas/bundle-profile-patch.md)

Authors publish a **bundle** (`dsh.bundle.patch` in `package.json` points at a patch). Users boot a **profile** (`$DSH_HOME/profiles/<name>`). A later layer overrides row by row, and `config` replaces the whole object rather than deep-merging.

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

Installation uses two manifests, both under the `package.json` key `dsh`, and they answer different questions.

- A **bundle** is an npm package that ships a configuration layer. `dsh.bundle.patch` is a patch file, or an ordered list of patch files, applied when a profile lists the bundle.
- A **profile** is a directory under `$DSH_HOME/profiles/<name>` describing one runnable composition. `dsh.profile.bundles` is the ordered bundle list. The profile's own `cordis.patch.yml` is the user's layer.

Nothing is both. A package without `dsh.bundle` still installs, but `dsh plugin` warns and activates no layer. Use that shape for a library other plugins import.

Official packages do not use a `dsh.plugin.json` file. Discovery of that filename in the official tree at this commit finds nothing.

## Where it lives

- Tutorial: [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)
- Shipped bundles: [packages/bundle/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/README.md)
- Base patch: [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
- Profile boot: [packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
- Design note: [.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md)
- Display metadata: [packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)

In-box bundle package names are `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`, `@deepseek-ai/dsh-acp-app`, `@deepseek-ai/dsh-sdk-app`, and `@deepseek-ai/dsh-sdk-minimal`. `web`, `headless`, `acp`, and `sdk` build on `dsh-base`. `sdk-minimal` supplies its complete tree in one bundle.

## Contract

Bundle manifest:

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`patch` may be an ordered list. The launcher applies those files as one layer. Relative plugin paths resolve beside the file that names them.

Profile manifest (written by `dsh plugin`, not by hand):

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-hello-plugin"] } }
```

Effective configuration composes over an empty root. Later layers win per row:

1. Each bundle patch in `dsh.profile.bundles` order. `@deepseek-ai/dsh-base` is first on a base-backed profile, then installed bundles in add order.
2. The profile's `cordis.patch.yml`.
3. `$DSH_HOME/cordis.patch.yml`, shared by every profile on that machine. This home file outranks the per-profile patch.
4. Each `--patch <path>` overlay, in argv order.

A patch replaces a row's entire `config` value. It does not deep-merge keys. Restate every key the row needs.

Patch documents are YAML arrays. Common entry shapes:

- `- insert:` followed by new rows (`id`, `name`, `config`, `disabled`).
- `- id: <entryId>` to override an existing row, with optional `name`, `disabled`, and `config`.
- `disabled: !!js "..."` so the loader evaluates the expression when the row activates.

The loader also understands native `group`, `cordis:include`, and `isolate`. Those are Cordis composition features; see the primer. There is no patch opcode named `fork`.

In-box bundle names resolve from the dsh installation first, then from the profile's `node_modules`.

Plugin Manager cards read `locale/en.json` (and `locale/zh.json`) without activating the plugin:

```json
{ "meta": { "title": "My plugin", "description": "What the card shows." } }
```

Export `./locale/*.json` and `./package.json`. An optional top-level `icon` is a relative SVG, PNG, JPEG, or WebP up to 256 KiB inside the package directory. Missing fields fall back to `name` and `description`.

Peers: declare host packages whose instance you must share (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`) in both `peerDependencies` and `devDependencies` when you import them. The publish tutorial states that, at the manifest's lookup position, peers present in the running dsh use the installation's copy. `engines.dsh` is an author-declared range; [packages/util/package-manifest/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/util/package-manifest/README.md) says current installers and loaders do not enforce it. Peer ranges on `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` are checked against `getDshRuntimeVersion()`. See [CLI](cli.md).

## How a plugin author uses it

- Ship `dsh.bundle.patch` and a patch that `insert`s your plugin row by package name, not by a source-checkout path.
- Give the package name and every row `id` unique names.
- Override an earlier row only by its stable `id`, and copy the full `config` you intend to keep.
- Put user-tunable defaults in the schema. Put values you expect most users to keep in the patch.
- Verify without booting: `dsh --profile <name> --dump-config`. A layer banner such as `# == your-package` shows that the bundle contributed. `--dump-config-schema` prints JSON Schema for the composed plugins and imports those modules, so run it only on plugins you trust.
- Linked checkouts keep their own `node_modules`. A git install does not run `build` unless `prepare` does. See [CLI](cli.md).

## Sources

- [docs/user/develop/basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/docs/user/develop/basic/publish.md)
- [packages/bundle/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/README.md)
- [packages/bundle/base/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/README.md)
- [packages/bundle/base/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/bundle/base/cordis.patch.yml)
- [packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/boot/app-boot/README.md)
- [.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)
- [packages/util/package-manifest/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/util/package-manifest/README.md)
