## 改动

## 测试

- [ ] 相关包的 typecheck / test / build，或 `pnpm check`
- [ ] 改了验收脚本时跑过 `pnpm test:acceptance`

## 用户可见界面

本 PR 是否改变用户在 DeepSeek Harness 里看得见或点得到的界面？

- 否。原因：

- 是。用本 PR 代码在隔离的 DeepSeek Harness 里录的真实 GIF（不是生成动画、静态 mock 或旧录屏）：
  - 录制 commit：
  - 覆盖场景：
  - 与当前 head 的差异（没有则写「与 head 一致」）：

GIF 不代替自动测试和独立审查。录制 commit 之后如果又改了相关界面，需要重录。

## 文档

- [ ] 有界面的插件：双语 README 在概述后带真实演示图（`docs/demo-assets` 分支绝对地址，或包外 `screenshots/`、`docs/` 相对路径；图片不进 npm 包）
- [ ] 收录进站点目录或改动简介时：已同步 `site/catalog.json` 并运行 `pnpm release:docs` 更新根 README

## 发布

- [ ] 未改插件版本，未手动发布

---

## Change

## Tests

- [ ] Typecheck / test / build for the packages touched, or `pnpm check`
- [ ] `pnpm test:acceptance` when the acceptance runner changed

## User-visible interface

Does this PR change what a person sees or does in DeepSeek Harness?

- No. Reason:

- Yes. Real GIF recorded from this PR's code in an isolated DeepSeek Harness (not a generated animation, static mock, or older recording):
  - Recorded commit:
  - Scenarios covered:
  - Difference from the current head (or "matches head"):

The GIF does not replace automated tests or independent review. Re-record after any later interface change.

## Documentation

- [ ] Plugins with an interface: both READMEs show a real demo image after the overview (absolute `docs/demo-assets` URL, or a relative `screenshots/` / `docs/` path kept out of the npm package)
- [ ] Catalog-listed plugins or summary changes: `site/catalog.json` is updated and `pnpm release:docs` was run to sync the root READMEs

## Release

- [ ] No plugin version bump and no manual publish
