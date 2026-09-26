# MCP 服务器

[English](../../areas/mcp.md)

外部 MCP 服务器用一条 `@deepseek-ai/dsh-mcp-client` 配置接入。工具名变成 `mcp__<serverName>__<tool>`。只加 client 行；官方 profile 已经挂了 `mcp-resources`。

索引所对照的版本是 [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443)（`477b4f420553e8a52c2fbccc464d7561b239c443`）。

## 它是什么

MCP 这一组把外部的模型上下文协议服务器暴露成原生工具。`@deepseek-ai/dsh-mcp-client` 是一台已配置的服务器。`@deepseek-ai/dsh-mcp-resources` 暴露那台服务器的资源。随发行的 profile 把资源插件挂载一次，所以增加一台服务器的 bundle 只配置一行 client。

## 它在哪里

- 分组：[packages/mcp/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/README.md)
- client 包：[packages/mcp/mcp-client/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/mcp-client/README.md)
- bundle 指南：[packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md)
- 模板：[packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml)

## 约定

随发行的模板是一个只含配置的 bundle。它没有宿主插件入口：

```yaml
- insert:
    - id: demo-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: streamable-http
        url: http://127.0.0.1:3000/mcp
        failOnStartupError: true
```

`transport` 是 `stdio` 或 `streamable-http`。HTTP 使用 `url`。stdio 使用 `command`，以及可选的 `args`、`env` 和 `cwd`。工具以 `mcp__<serverName>__<tool>` 的形式出现。

`failOnStartupError: true` 会在启动时连不上服务器时让这一行失败。添加超时、请求头或启用键之前，先读 `packages/mcp/mcp-client/README.md` 和配置目录。不要从另一个 MCP client 发明键。

凭据属于加载器的 `!!js` 表达式，不属于聊天记录，也不作为已提交的默认秘密。

## 插件作者怎么用

- 如果这项能力已经作为 MCP 服务器存在，就发布一个补丁里插入一行 `dsh-mcp-client` 的 bundle。不要把服务器重新实现成 Cordis 工具。
- 给 `serverName` 一个稳定的记号。它会成为每个工具名的一部分。
- 用 `dsh plugin add` 或 `plugin_manager` 的 `install_bundle` 安装，然后调用一个 `mcp__<serverName>__<tool>` 来证明连接。
- 自定义的进程内工具是[工具插件](tools.md)，不是 MCP 行。

## 来源

- [packages/mcp/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/README.md)
- [packages/mcp/mcp-client/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/mcp-client/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml)
