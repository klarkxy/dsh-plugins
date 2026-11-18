# 本仓插件的隔离验收场景

在仓库根目录构建过要看的插件后，用 `scripts/dsh-qa-harness.js` 跑。下面的选择器按各插件 locale 的 `meta.title` 来写；宿主如果把入口渲染成别的角色，改成实际控件，不要为了让场景变绿去放宽 `assertClean`。

## 1. 无服务外壳

不挂插件、不提交对话、不调用模型：

```sh
node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js \
  --mock-shell \
  --gif-name shell.gif \
  --out-dir "<temp-dir>/dsh-shell-qa"
```

对应模块是同目录的 `mock-shell-scenario.mjs`。它先点「预览版说明」里的「继续 / Continue」，再点随后出现的「开始使用」对话框上的「关闭」。不点「登录」或「添加 API Key」，也不提交对话。然后要求页面没有 token、没有 pageerror、没有 `/api` 或 `/plugins` 的 4xx/5xx。这两个框如果还在，场景失败。

## 2. 单个插件：字体

`@klarkxy/dsh-font` 的设置入口标题是「字体」/ `Font`。脚本会自动把 `@klarkxy/dsh-plugin-kit` 和 `@klarkxy/dsh-model-route` 按依赖顺序 link 进临时 profile，不需要把它们写进命令，也不会装上知乎或搜索这类要外部服务的插件。

把场景放在临时目录，例如 `<temp-dir>/font-settings.mjs`：

```js
export async function run({ page, screenshot, captureFrame, assertClean }) {
  const font = page.getByRole('button', { name: /字体|Font/ })
    .or(page.getByRole('link', { name: /字体|Font/ }))
  await font.first().waitFor({ state: 'visible', timeout: 15_000 })
  await font.first().click()
  await page.waitForTimeout(500)
  await captureFrame(700)
  await screenshot('font-settings.png')
  await page.waitForTimeout(1200)
  assertClean()
}
```

```sh
node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js \
  --plugin plugins/dsh-font \
  --scenario "<temp-dir>/font-settings.mjs" \
  --locale zh-CN \
  --gif-name font-settings.gif \
  --out-dir "<temp-dir>/dsh-font-qa"
```

深色主题加 `--color-scheme dark`。英文界面把 `--locale` 换成 `en-US`，场景仍用同一个可访问名称正则。

## 3. 多个插件

重复 `--plugin`。每个插件只带上它自己在 `plugins/` 里的 workspace 依赖，共享库只 link 一次。

```sh
node .agents/skills/dsh-web-acceptance/scripts/dsh-qa-harness.js \
  --plugin plugins/dsh-font \
  --plugin plugins/dsh-shortcuts \
  --scenario "<temp-dir>/two-plugins.mjs" \
  --gif-name font-and-shortcuts.gif \
  --out-dir "<temp-dir>/dsh-two-plugins"
```

需要外部账号、搜索服务或模型的插件（例如知乎、网页搜索、模型枢纽）不要放进这条无服务冒烟里。要录它们的界面时，用假端点或本地夹具，不要把生产密钥或付费接口写进 `--allow-env`。

## 4. PR 正文

GIF 来自这次命令写出的文件，对应 `qa-report.json` 里的 `commit`。覆盖的操作和结果写在正文里。录制之后如果又改了界面，用新的 head 重录。文件留在临时目录，不进 git。
