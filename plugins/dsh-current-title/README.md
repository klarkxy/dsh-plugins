# dsh-current-title

[Chinese documentation](README.zh-CN.md)

A host-only DeepSeek Harness bundle that keeps a session title aligned with the task being discussed now instead of permanently describing the opening prompt.

Titles use this fixed shape:

```text
0903 | Fix | Repair login callback
```

The provider runs asynchronously after every eligible human prompt, selects the newest useful prompt window, and lets the normal DSH title service persist the result. A manual rename remains pinned and is never overwritten automatically.

## Compatibility

Built and tested against the DSH `0.1.2-rc.1` provider and patch contracts. It disables the profile's built-in `session-title-llm` row and inserts `current-session-title-llm`, so do not install another bundle that owns the automatic title-provider slot.

## Install from this checkout

Build first, then add the package to the chosen profile:

```bash
pnpm install
pnpm --filter dsh-current-title build
dsh plugin --profile web add ./plugins/dsh-current-title
```

Restart that profile after installation. Verify the composition with:

```bash
dsh --profile web --dump-config
```

The `session-title-llm` row should be disabled and `current-session-title-llm` should name `dsh-current-title`.

## Configuration

Override the complete `current-session-title-llm` row in the profile patch when changing values:

| Key | Default | Meaning |
| --- | ---: | --- |
| `maxRecentMessages` | `8` | Maximum recent human prompts considered. |
| `locale` | `auto` | Type-label locale: `auto`, `zh`, or `en`. Auto uses the explicit DSH locale preference, then the recent message language. |
| `targetWords` | `5` | Maximum non-CJK summary words. |
| `targetCjkCharacters` | `10` | Maximum CJK summary code points. |
| `maxInputBytes` | `4096` | Hard UTF-8 limit for the complete framed input. |
| `maxOutputTokens` | `64` | Auxiliary response limit. |
| `timeoutMs` | `60000` | End-to-end title request deadline. |
| `provider`, `model` | inherited | Optional explicit route; set both or neither. |

The model returns stable semantic keys: `feature`, `fix`, `optimize`, `refactor`, `test`, `docs`, `release`, `config`, `explore`, and `discuss`. The plugin localizes those keys when it formats the title. English labels are `Feature`, `Fix`, `Optimize`, `Refactor`, `Test`, `Docs`, `Release`, `Config`, `Explore`, and `Discussion`.

## Windows paths

If the checkout path contains spaces and the DSH plugin command splits the local path, pack the plugin and install the generated archive from a path without spaces.

## License

[SATA License 2.1](LICENSE)

## Uninstall

```bash
dsh plugin --profile web remove dsh-current-title
```
