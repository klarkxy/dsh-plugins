# @klarkxy/dsh-update

[English](./README.en.md)

<!-- release-state-note -->

在执行 DeepSeek Harness 本体升级或任意已安装第三方插件更新前，先弹窗展示从当前版本到目标最新版本之间的 GitHub Release 变更日志，仅在用户确认后才开始更新并生效。

## 演示

![「插件 → 更新」：紧凑列表、筛选与宽窄布局](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/pr34-update-list-final.gif)

![桌面端更新：变更日志确认后交给宿主下载](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/desktop-update-handoff.gif)

## 下载量

[![npm 每日下载量趋势](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-update.svg)](https://www.npmjs.com/package/@klarkxy/dsh-update)

## 功能简介

- **拦截桌面端「新版本」直接下载**：点击侧栏底部「新版本」按钮时不再立即后台下载安装包，而是先打开变更弹窗，列出当前 DSH 版本到目标最新版本之间的全部 Release 日志。
- **单插件与批量更新检查**：在「插件」页面新增「更新」标签页，并在每个第三方插件详情页头部提供「检查更新 / 查看更新」入口，统一展示 npm 注册表插件与 Git 仓库插件的可用新版本及区间 Release 日志。
- **先看日志、宿主确认后生效**：所有检查操作均为只读。弹窗里的确认只会向宿主请求批准；宿主没有批准时不会安装或升级。桌面端下载仍交给宿主自己的更新按钮。

## 安装方式

本包在仓库内整理验证期间尚未发布到 npm，可从本地工作区目录或 Git 仓库子目录安装：

```bash
dsh plugin add "git+https://github.com/klarkxy/dsh-plugins.git#<commit-sha>&path:/plugins/dsh-update"
```

或在克隆并构建本仓库后按本地路径安装：

```bash
dsh plugin add ./plugins/dsh-update
```

## 使用方法

1. **查看并确认 DSH 本体更新**：
   - 在桌面端出现「新版本」按钮时直接点击该按钮，或在「插件 → 更新」中点击检查更新，即可查看当前版本至最新版本之间的 Release 变更记录（双语发布说明可切换当前语言摘要或完整原文）。
   - 核对变更内容后点击「开始下载并更新」，才会正式启动更新流程；点击「暂不更新」或关闭弹窗不会触发任何下载。
2. **查看并确认单个或全部插件更新**：
   - 打开「插件 → 更新」标签页可集中检查所有已安装第三方插件的新版本，也可进入任意插件详情页点击页头的「检查更新 / 查看更新」。
   - 在弹窗中审阅区间 Release 日志后点击「确认更新并生效」。宿主批准后才会替换目标版本并按当前配置热重载（若宿主未开启热重载则会提示重启生效）。宿主拒绝或无法确认时，已安装的插件保持原样。

## 主要限制

- **依赖公开或已认证的 GitHub Releases**：变更内容读取自目标项目声明的 GitHub 仓库 Releases；若某个插件未在清单中声明 GitHub 仓库或发布新版本时未创建 Release 记录，弹窗会提示缺少区间日志并提供仓库链接供核对。
- **写操作必须由宿主批准**：页面里的确认按钮不能单独授权安装。宿主没有提供确认时，更新请求会被拒绝，不会调用插件管理器，也不会执行全局安装。
- **本地链接插件不做在线覆盖**：通过 `link:` 或 `file:` 挂载的本地开发插件不会执行在线覆盖更新，需在本地源码目录重新构建。
- **GitHub API 访问频率**：未登录 `gh` CLI 且未配置 `GITHUB_TOKEN` 时使用匿名 GitHub API，短时间高频刷新可能受 GitHub 匿名速率限制影响。
