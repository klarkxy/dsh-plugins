# MCP servers

中文：外部 MCP 服务器用一条 `@deepseek-ai/dsh-mcp-client` 配置接入。工具名变成 `mcp__<serverName>__<tool>`。只加 client 行；官方 profile 已经挂了 `mcp-resources`。

Indexed against [dsh-v0.1.7-rc.2](https://github.com/deepseek-ai/deepseek-harness/tree/477b4f420553e8a52c2fbccc464d7561b239c443) (`477b4f420553e8a52c2fbccc464d7561b239c443`).

## What it is

The MCP group exposes external Model Context Protocol servers as native tools. `@deepseek-ai/dsh-mcp-client` is one configured server. `@deepseek-ai/dsh-mcp-resources` exposes that server's resources. Shipped profiles mount the resources plugin once, so a bundle that adds a server configures only a client row.

## Where it lives

- Group: [packages/mcp/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/README.md)
- Client package: [packages/mcp/mcp-client/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/mcp-client/README.md)
- Bundle guide: [packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md)
- Template: [packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml)

## Contract

The shipped template is a configuration-only bundle. It has no host plugin entry:

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

`transport` is `stdio` or `streamable-http`. HTTP uses `url`. Stdio uses `command` plus optional `args`, `env`, and `cwd`. Tools appear as `mcp__<serverName>__<tool>`.

`failOnStartupError: true` fails the row when the server cannot be reached at startup. Read `packages/mcp/mcp-client/README.md` and the config catalog before adding timeout, header, or enablement keys. Do not invent keys from another MCP client.

Credentials belong in Loader `!!js` expressions, not in a chat transcript and not as a committed default secret.

## How a plugin author uses it

- If the capability already exists as an MCP server, ship a bundle whose patch inserts one `dsh-mcp-client` row. Do not reimplement the server as a Cordis tool.
- Give `serverName` a stable token. It becomes part of every tool name.
- Install with `dsh plugin add` or `plugin_manager` `install_bundle`, then call one `mcp__<serverName>__<tool>` to prove the connection.
- A custom in-process tool is a [tool plugin](tools.md), not an MCP row.

## Sources

- [packages/mcp/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/README.md)
- [packages/mcp/mcp-client/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/mcp/mcp-client/README.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/references/mcp-bundle.md)
- [packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml](https://github.com/deepseek-ai/deepseek-harness/blob/477b4f420553e8a52c2fbccc464d7561b239c443/packages/preset/agent-preset/skills/cordis-plugin-development/templates/mcp/cordis.patch.yml)
