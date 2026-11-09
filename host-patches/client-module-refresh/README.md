# Web refresh module-loading fix

[简体中文](README.zh-CN.md)

Prevents the same client module from loading twice when DSH Web receives an unchanged startup configuration while its scripts are still loading.

## Install

Stop the Web instance that uses the target profile. Stage a verified package into that profile's `node_modules/@deepseek-ai/dsh-client-modules` directory:

```powershell
node .\host-patches\client-module-refresh\stage.mjs --destination '<absolute profile path>\node_modules\@deepseek-ai\dsh-client-modules'
```

The destination must not exist. The installer checks the original package before creating a separate copy; it does not modify the source installation. Start that Web profile again.

## Use

Refresh DSH Web normally. Real module changes still reload, and actual duplicate registrations still report an error.

## Limits

- Only the inspected Host artifact is supported. A Host upgrade requires another review.
- This is a local Web profile fix. It does not update an existing desktop installation.
- To undo it, stop that Web instance and remove only the staged package directory identified in `.refresh-patch.json`, then restart.

Original Host code is Copyright (c) 2026 DeepSeek under the accompanying MIT license.
