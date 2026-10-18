# dsh-plugins

简体中文 / [English](README.md)

klarkxy 的 DeepSeek Harness（DSH）插件。可以在[插件站点](https://klarkxy.github.io/dsh-plugins/)浏览，那里有安装命令和各插件的说明。

## 插件

| 包 | 作用 |
| --- | --- |
| [`@klarkxy/dsh-current-title`](plugins/dsh-current-title/docs/README.zh-CN.md) | 自动标题：会话标题跟随最新任务，手动改过的名字不被覆盖。 |
| [`@klarkxy/dsh-git-commit`](plugins/dsh-git-commit/docs/README.zh-CN.md) | Git 提交：在对话里提交工作区改动，由模型分组。 |
| [`@klarkxy/dsh-safe-auto`](plugins/dsh-safe-auto/README.zh-CN.md) | 安全自动：需要审批的请求交给审核模型判断，通过才放行这一次。 |
| [`@klarkxy/dsh-session-manager`](plugins/dsh-session-manager/README.zh-CN.md) | 会话管理：跨工作目录查找和阅读会话，使用临时工作区；空输入一键继续，久离回来给出摘要与压缩建议。 |
| [`@klarkxy/dsh-model-hub`](plugins/dsh-model-hub/docs/README.zh-CN.md) | 模型枢纽：在一个页面修改各插件和子代理使用的模型，并查看运行中子代理的模型与思考强度。 |
| [`@klarkxy/dsh-web-search-manager`](plugins/dsh-web-search-manager/docs/README.zh-CN.md) | 网页搜索：在一个设置页管理和排序多家搜索与网页读取服务，包括已安装插件提供的能力。 |
| [`@klarkxy/dsh-zhihu`](plugins/dsh-zhihu/docs/README.zh-CN.md) | 知乎：知乎搜索、智能体工具、知识库和用量统计。 |
| [`@klarkxy/dsh-font`](plugins/dsh-font/docs/README.zh-CN.md) | 字体：自定义 Web GUI 的界面字体、代码字体与会话字号。 |
| [`@klarkxy/dsh-unrestricted`](plugins/dsh-unrestricted/README.zh-CN.md) | 破限：解除模型的回答限制、交付完整成果的会话 Preset，只作用于选用它的会话；可能导致账号被封禁。 |
| [`@klarkxy/dsh-dev-index`](plugins/dsh-dev-index/README.zh-CN.md) | DSH 文档：在插件页阅读官方文档；创造模式可查文档和 npm 与 GitHub 上的插件。 |

`@klarkxy/dsh-plugin-kit` 和 `@klarkxy/dsh-model-route` 是共享库，其他插件会自动安装它们。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-current-title
```

把 `web` 换成你的 profile 名，安装后重启该 profile。插件依赖的共享库会随它一起装上。

## 开发

需要 Node.js 24+ 与 pnpm 10。

```bash
pnpm install
pnpm check
```

代码就是开发文档。发布流程见[发布指南](RELEASING.zh-CN.md)。

## 插件生命周期

<!-- plugin-release-states:start -->
| 包 | 生命周期 | 说明 |
| --- | --- | --- |
| [@klarkxy/dsh-current-title](plugins/dsh-current-title/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-dev-index](plugins/dsh-dev-index/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-font](plugins/dsh-font/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-git-commit](plugins/dsh-git-commit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-model-hub](plugins/dsh-model-hub/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-model-route](plugins/dsh-model-route/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-plugin-kit](plugins/dsh-plugin-kit/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-safe-auto](plugins/dsh-safe-auto/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-session-manager](plugins/dsh-session-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-shortcuts](plugins/dsh-shortcuts/README.md) | 草稿 (`draft`) | 新增快捷键管理与可扩展命令面板，尚未发布。 |
| [@klarkxy/dsh-unrestricted](plugins/dsh-unrestricted/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续版本按正常更新流程维护。 |
| [@klarkxy/dsh-web-search-manager](plugins/dsh-web-search-manager/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
| [@klarkxy/dsh-zhihu](plugins/dsh-zhihu/README.md) | 已发布 (`published`) | 已有 npm 发布记录；后续修复、测试和版本更新保持已发布。 |
<!-- plugin-release-states:end -->

## 许可证

[SATA License 2.1](LICENSE)
