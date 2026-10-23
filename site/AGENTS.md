# site/ 专项规则

改动 `site/**`（插件发布站 <https://klarkxy.github.io/dsh-plugins/>）时适用；通用规则见根目录 `AGENTS.md`。

站点由 `site/` 生成到 `_site/`（不提交）。旧开发索引和根目录 `docs/` 已移除，不要恢复。

| 文件 | 职责 |
| --- | --- |
| `site/catalog.json` | 唯一手工维护的数据 |
| `site/render.mjs` | 纯渲染：catalog + npm 数据 → 页面、`plugins.json`、`index.json`、`llms.txt`，不做 I/O |
| `site/build.mjs` | 拉 npm 数据，校验发布包并写 `_site/` |
| `site/npm.mjs` | 在内存中校验读取 npm 包，不落盘 |
| `site/assets/` | 样式与脚本；只做渐进增强，无 JS 也要可用 |
| `site/site.test.mjs` | 离线测试，含在 `pnpm check` |

`plugins.json`、`index.json`（插件市场索引，只收 bundle 类）、`llms.txt` 由构建生成，不手写，改动在 `site.test.mjs` 覆盖。

## 增改/下线插件

只改 `catalog.json` 并同步根 README 插件表格。规则：只收录 npm 上有 `latest` 的 DSH 插件（未发布会让构建失败）；`slug` 用小写字母数字连字符、通常去掉作用域和 `dsh-` 前缀，已发布 slug 不改名；`category` 用 `categories` 里的 id，`kind` 只取 `preset`/`plugin`/`service`；`title`/`summary` 双语，一句话说用户价值；`readme.zh`/`readme.en` 填包内相对路径（缺语言仍填预期路径，构建警告并回退）；`repository` 填 GitHub URL，`directory` 是子目录（根即包填 `""`）；版本、日期、依赖、图标不写（构建时从 npm 读，依赖按 catalog 内同名依赖自动推导；安装命令只含插件本身和未标 `optional` 的必需 peer——`dsh plugin add` 转发 pnpm 且 profile `autoInstallPeers: false`，其余自动装）。

## 修改渲染

README 原始 HTML 只保留 `<img>`、`<br>`，链接/图片地址只允许 http(s)、mailto、锚点、相对路径，不放宽；改链接改写、依赖推导或页面结构时在 `site.test.mjs` 补离线测试；中文在根路径、英文在 `en/`，结构一致，新文案同步 `render.mjs` 的 `T.zh`/`T.en`；视觉蓝墨配冷色纸底，只有安装命令行强调，不引外部字体、CDN、统计。

## 验证与部署

`pnpm site:test`（离线）、`pnpm site:build`（拉线上数据）、`node site/build.mjs --save-snapshot|--snapshot .scratch/snap.json`（快照离线重建）、`pnpm check`。改页面后本地预览 `_site/`（桌面+手机宽度）；站点在 `/dsh-plugins/` 子路径下，页面内链接用相对路径（404 除外）。部署：`.github/workflows/pages.yml` 在推 `main`、**Publish npm plugins** 结束后和每天 01:17 UTC 跑 test+build 并部署；拉取失败即构建失败，线上保留上一版，不吞网络错误、不用过期数据。
