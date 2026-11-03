# Magpie

<!-- release-state-note -->

[English](../README.md)

把 DSH 连接到本机、局域网或其他位置的 [magpie](https://usemagpie.ai) 网关。在插件设置页填写网关地址后，插件会拉取网关的模型列表，写入与 `magpie dsh` 相同的供应商路由——Magpie、Magpie · Responses、Magpie · Anthropic——并同步默认模型和网络搜索，模型随即出现在模型选择器中。

## 安装

```bash
dsh plugin --profile <name> add @klarkxy/dsh-magpie
```

把 `<name>` 换成你的 profile 名，安装后重启 profile。

## 使用

- 打开「插件 → Magpie」。填写网关地址（本机默认 `http://127.0.0.1:3425`），网关要求时粘贴网关 Key，点「保存」，再点「立即同步」。
- 「测试」只检查连接，不改动任何配置。
- 可选一个**默认模型**用于新会话；打开**网络搜索**可用网关模型执行搜索。
- 「启动时同步」会在每次启动 profile 时刷新一次路由。
- 「断开连接」移除三条 magpie 路由并还原默认模型与网络搜索；已保存的 Key 保留。

## 限制

- 同时只接一个网关。路由与 `magpie dsh` 写出的相同，两者可互相替换配置。
- 其他机器上的网关需要在 magpie 中打开 Share on local network，并创建网关 Key（`magpie gateway-key add <name>`）。
- 可用模型以 magpie 提供给 DSH 的列表为准。
- 默认模型作用于新会话；已有会话保持当前模型。
- 网络搜索经由网关的模型执行。
- 没有凭据存储的宿主（如 headless）从 `MAGPIE_GATEWAY_KEY` 环境变量读取网关 Key。

## 许可证

[SATA License 2.1](../LICENSE)
