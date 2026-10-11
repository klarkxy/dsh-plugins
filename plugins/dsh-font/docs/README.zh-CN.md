# @klarkxy/dsh-font

字体：在一个设置面板里自定义 DeepSeek Harness Web GUI 的**界面字体**、**代码字体**和**会话字号**。

[English](../README.md)

## 功能

插件在「插件」页自己的 Bundle 详情页里提供设置面板：

- **界面字体** —— 整个界面文字的字体。可选预设（微软雅黑、苹方、宋体、楷体、思源黑体/宋体），也可以点「读取系统字体」从本机已装字体里挑，或输入任意 CSS `font-family` 字体栈。留空恢复宿主默认。
- **代码字体** —— 代码块、行内代码与终端的等宽字体。预设含 Cascadia、JetBrains Mono、Fira Code、Consolas、更纱黑体、Maple Mono，同样支持系统字体与自定义。
- **会话字号** —— 10–22 px，走官方 `ctx.theme.setFontSize()` 入口，与「设置 → 通用」里的字号步进器实时同步，并由宿主设置域持久化。

「读取系统字体」用的是 Local Font Access API（`window.queryLocalFonts()`）：仅 Chromium 系可用，首次会弹浏览器权限授权。每次点击都重新枚举——首次读取后按钮变为「重新读取系统字体」，新装字体再点一次即可刷新。列表项写入的始终是 CSS 精确匹配需要的族名，但显示以界面语言为准——同一款转换字体在中文界面显示 `华康少女文字W5(P)（DFPShaoNvW5-GB）`，在英文界面显示 `DFPShaoNvW5-GB（华康少女文字W5(P)）`。在不支持或被拒绝的环境（Firefox、Safari、Electron 权限策略）里，面板退回预设 + 手填，不受影响。包内不带任何字体文件——所有选择都靠本机已装字体渲染，缺字体时按栈回退。

改动立即生效：字体覆盖写入 `<html>` 上的宿主 `:root` 字体 token（`--dsw-font-family`、`--ds-font-family-code`），Markdown、品牌和终端的派生字体随之更新。选择「默认」或卸载插件时，恢复原来的内联值，并保留其他写入者后来的修改。

## 设置存在哪里

字体选择沿用原有浏览器 `localStorage` 键和格式。每个浏览器、每台机器装的字体不同，所以本插件的字体选择仍留在浏览器本地。字号不需要本地副本：theme 服务通过 `setFontSize(px)` 将它保存在宿主侧。

宿主侧（host half）是刻意留空的：没有 Host service、没有 RPC、不调模型。

## 安装

安装预发布通道（需要 DSH 0.2.0-rc.2 或更高版本）：

```bash
dsh plugin --profile web add @klarkxy/dsh-font@next
```

把 `web` 换成你的 profile 名，安装后重启 profile（或刷新页面），然后打开「插件 → 字体」调整。

## 开发

```bash
pnpm --filter @klarkxy/dsh-font build       # tsdown + client wrapper
pnpm --filter @klarkxy/dsh-font typecheck
pnpm --filter @klarkxy/dsh-font test
```

预发布使用 npm `next` 标签；有 `latest` 版本后再收录到稳定插件目录。
