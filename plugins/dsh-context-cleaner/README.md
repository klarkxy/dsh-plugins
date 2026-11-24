# 上下文面板清理

<!-- release-state-note -->

简体中文 / [English](README.en.md)

隐藏 `dsh-context` 仪表盘右上角的插件信息卡和推广推荐卡，让统计卡片铺满顶部一行。

## 下载量

[![npm 每日下载量趋势](https://raw.githubusercontent.com/klarkxy/dsh-plugins/docs/demo-assets/downloads-context-cleaner.svg)](https://www.npmjs.com/package/@klarkxy/dsh-context-cleaner)

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-context-cleaner
```

把 `web` 换成你的 profile 名，安装后按提示重启 profile，并在插件列表中确认启用「上下文面板清理」。无需其他配置。

## 使用

需先安装并启用 `dsh-context`——本插件仅负责清理面板样式，不提供上下文面板本身。启用后即可自动生效，无需额外操作。插件启用期间，`dsh-context` 上下文标签页与侧边栏入口中的插件信息卡和推广卡都会保持隐藏，原本占用的右列随之收起。停用或卸载本插件后，卡片会立即恢复显示。

## 主要限制

- 隐藏效果依赖 `dsh-context` 当前渲染的界面结构，上游改版后可能需要同步更新本插件。
- 本插件仅做界面视觉隐藏，`dsh-context` 后台仍会照常发起推荐内容请求。

## 许可证

[SATA License 2.1](LICENSE)
