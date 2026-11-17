# Web refresh module-loading fix

[简体中文](README.md) / English

Prevents the same client module from loading twice when DSH Web receives an unchanged startup configuration while its scripts are still loading.

## Install

Stop the Web instance for the target profile, then stage a verified package copy into that profile's `node_modules/@deepseek-ai/dsh-client-modules` directory:

```powershell
node .\host-patches\client-module-refresh\stage.mjs --destination '<absolute profile path>\node_modules\@deepseek-ai\dsh-client-modules'
```

The destination must not exist. The installer checks the original package before creating a separate copy and leaves the source installation untouched. Start that Web profile again after staging.

## Use

Refresh DSH Web normally. Actual module changes still reload, and genuine duplicate registrations still report an error.

## Limitations

- Only the inspected Host package version is supported; a Host upgrade requires another review.
- This is a local Web profile fix and does not update an existing desktop installation.
- To undo it, stop that Web instance, remove only the staged package directory identified by `.refresh-patch.json`, and restart.

Original Host code is Copyright (c) 2026 DeepSeek under the accompanying [MIT license](UPSTREAM-LICENSE).
