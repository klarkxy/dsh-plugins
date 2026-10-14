# 字体

<!-- release-state-note -->

[English](../README.md)

自定义 DeepSeek Harness Web GUI 的界面字体、代码字体和会话字号。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-font
```

把 `web` 换成你的 profile 名，安装后重启 profile 或刷新页面。

## 使用

打开「插件 → 字体」：

- **界面字体**和**代码字体**：选预设、手动输入字体名，或点「读取系统字体」从本机已装字体中选择。
- **会话字号**：10–22 px，与「设置 → 通用」中的字号同步。

改动立即生效。选择「默认」即可恢复 DSH 原字体。

## 限制

- 「读取系统字体」只在 Chromium 系浏览器可用，首次使用需要授权。
- 字体选择保存在当前浏览器，换浏览器或访问地址后需重新设置；字号由 DSH 保存。
- 插件不附带字体文件，所选字体必须已安装在本机。

## 许可证

[SATA License 2.1](../LICENSE)
