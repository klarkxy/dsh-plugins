# AGENTS.md

本仓库是 klarkxy 的 DSH 插件 monorepo，同时托管插件发布站 <https://klarkxy.github.io/dsh-plugins/>。

## 插件站点

站点由 `site/` 生成，输出到 `_site/`（不提交）。`docs/` 旧开发索引已下线，不要恢复。

| 文件 | 职责 |
| --- | --- |
| `site/catalog.json` | 唯一手工维护的数据 |
| `site/render.mjs` | 纯渲染：catalog + npm 数据 → 文件内容，不做 I/O |
| `site/build.mjs` | 从 npm registry 和 jsDelivr 拉数据，写入 `_site/` |
| `site/assets/` | 样式与脚本；脚本只做渐进增强，页面无 JS 也要可用 |
| `site/site.test.mjs` | 离线测试，包含在 `pnpm check` |

### 新增、修改或下线插件

只改 `site/catalog.json`，并同步根目录 `README.md` 与 `README.zh-CN.md` 的插件表格。

- 只收录已发布到 npm、带 `latest` 标签的 DSH 插件。未发布的包会让构建失败；非 DSH 包不收录。
- `slug`：小写字母、数字和连字符，通常是包名去掉作用域和 `dsh-` 前缀。已发布的 slug 是公开 URL，不要改名。
- `category` 必须是 `categories` 里的 id；`kind` 只能是 `preset`、`plugin`、`service`。
- `title`、`summary` 必须同时有 `zh` 和 `en`。简介一句话，从用户角度说它做什么，不写实现细节或宣传语。
- `readme.zh` / `readme.en` 写包内实际存在的路径（相对包根目录）。某个语言没有 README 时仍填预期路径，构建会警告并回退到另一种语言。
- `repository` 为 `https://github.com/<owner>/<repo>`；`directory` 是包在仓库中的子目录，仓库根目录即包时填 `""`。
- 不要把版本、日期、依赖、图标写进 catalog，这些在构建时从 npm 读取。插件依赖根据 `dependencies` / `peerDependencies` 中同样在 catalog 里的包自动推导。

### 修改渲染

- README 里的原始 HTML 不原样输出，只保留 `<img>` 和 `<br>`；链接和图片地址只允许 `http(s)`、`mailto`、锚点和相对路径。不要放宽这条规则。
- 改链接改写、依赖推导或页面结构时，在 `site/site.test.mjs` 补测试。测试要离线运行，不访问网络。
- 首页和详情页都是中文在根路径、英文在 `en/` 下，两种语言的页面结构保持一致；新增文案要同时加到 `render.mjs` 的 `T.zh` 和 `T.en`。
- 视觉方向：蓝墨色配冷色纸底，只有安装命令那一行做强调。不要引入外部字体、CDN 脚本或统计代码。

### 验证

```bash
pnpm site:test                                     # 离线渲染测试
pnpm site:build                                    # 拉取线上数据生成 _site/
node site/build.mjs --save-snapshot .scratch/snap.json   # 保存数据快照
node site/build.mjs --snapshot .scratch/snap.json        # 用快照离线重建
pnpm check                                         # 全仓检查
```

改动页面后在本地起静态服务预览 `_site/`，桌面和手机宽度都要看；站点部署在 `/dsh-plugins/` 子路径下，页面内链接必须用相对路径（404 页除外）。快照和预览文件放在 `.scratch/`，用完删除。

### 部署

`.github/workflows/pages.yml` 在推送 `main`、`Publish npm plugins` 工作流结束后，以及每天 01:17 UTC 运行 `site:test` 和 `site:build`，再部署 `_site/`。拉取失败时构建直接失败，线上保留上一版，不要为了让构建通过而吞掉网络错误或改用过期数据。

## 与 npm 发布的关系

标记 `private: true` 的开发包参加构建、测试与打包检查，但 `scripts/release-target.mjs` 会将其排除在自动发布目标之外；未发布包不加入站点 catalog。

公开包 `plugins/*` 下被 `npm pack` 打包的文件（含 `package.json`、README）内容一变，`npm-publish.yml` 就会自动发布 patch 版本。只改 `site/`、根 README 或测试不会触发发布。插件的 `homepage` 指向对应详情页 `https://klarkxy.github.io/dsh-plugins/plugins/<slug>/`。

## 官方包依赖约定

`@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 包由宿主运行时提供，**永远不要放进 `dependencies`**，也不要在任何字段写死精确版本或 `<0.2.0` 这类上界。写死版本会让 pnpm 把旧版官方包装进 profile 的 node_modules，宿主 loader 解析内置插件行时命中旧拷贝、版本检查不通过直接禁用（0.1.7→0.2.0 升级时 storage-domain 被禁用、workspaceController 全线 pending 就是这么炸的）。

- 宿主包含的包（对照 DSH 安装目录 `node_modules/@deepseek-ai`）：`peerDependencies` 写开放下界（`>=0.1.7-rc.2`，loader 只按这个范围对运行时版本做兼容检查），并在 `peerDependenciesMeta` 标 `optional: true`，防止 pnpm auto-install-peers 把物理副本装进 profile；`devDependencies` 保留精确版本供本地 typecheck/测试。
- 宿主不包含的包（如 `@deepseek-ai/dsh-web-search-exa`）：留在 `dependencies`，同样用开放下界，不写死。
- `engines.dsh` 也只写开放下界。
- 例外：确实需要独立副本的无状态工具包可以进 `dependencies`（官方文档允许的口径），但先确认它不在宿主安装目录里。

## 插件配置入口

插件自己的设置统一注册到 `plugins.bundle.config`，`key` 必须为 npm 包名；某个 bundle 行自己的设置使用 `plugins.row.config`。不要注册 `settings.section`、`settings.plugins.tab` 或旧的 `dsh-editor.settings.*`，也不要在插件页未声明时回退到全局设置。`slots.inject()` 等待宿主声明并负责卸载回收；标题与导航由宿主插件页提供。功能性搜索面板可以保留，但不要在那里重复提供凭据设置。迁移入口时保留 RPC、凭据引用、存储结构和已保存的开关，不触发模型调用。

新增或迁移配置入口时运行 `node --test scripts/plugin-settings.test.mjs`、`pnpm test:editor-build` 和相关插件测试；网络搜索还提供通过真实注册入口挂载的 `pnpm test:e2e:web-search` 浏览器回归。
