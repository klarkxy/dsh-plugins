# 模型选择器

<!-- release-state-note -->

简体中文 / [English](README.en.md)

为 DeepSeek Harness 输入框提供卡片网格与列表双视图的模型选择器——同一份选择器也以可复用组件形式提供给其他插件挂载。

## 功能

- **元素周期表风格卡片视图（默认）**：
  - 每张卡片展示序号、右上角可切换的供应商下拉菜单、居中大号模型简称（小字显示完整模型名），以及底部紧贴的推理强度分格。
  - **预置常见模型简称**：覆盖主流实验室与 `models.dev` 常见模型家族，包括 Gemini 4 元素符号（`H`、`He`、`C`、`Ne`、`Ar`、`Kr`、`Xe` 等）、Nano Banana / Gemma、Claude（`Op`/`Fb`/`Sn`/`Hk`）、DeepSeek（`Ds`/`Dr`/`Dc`）、OpenAI GPT-6 Astra/Sol/Luna/Terra/Cyber 与 Codex/o 系列、Grok（`Gr` 搭配版本角标区分 `4.6` / `4.7` 等并行版本）、GLM、MiniMax、Kimi、Qwen/QwQ、小米 MiMo、腾讯 Hy/混元、字节 Seed/Seedance/豆包、美团 LongCat、Ling/Ring、Step、Meta Muse/Llama、Microsoft MAI Code/Phi、NVIDIA Nemotron、Mistral 全系、Amazon Nova、Cohere Command、Perplexity Sonar、Inception Mercury（`Hg`）、Thinking Machines Inkling、Reflection Beam、Sakana Fugu、Upstage Solar 等，未匹配模型自动生成两位简称；双击简称可就地改名，清空恢复默认。
  - **同模型多渠道合并**：来自不同供应商的同名模型合并为同一张卡片，通过右上角下拉菜单直接切换供应商；同一家族不同版本保持为独立卡片并用角标区分。
  - **支持不传思考强度**：直接点击卡片中间只选中模型、不传推理强度；点击底部某个强度格一步选中模型与对应强度，再次点击已激活格子可取消。
  - **自由排版与宽度调节**：顶部滑块可实时调节卡片宽窄；拖拽卡片到目标卡片左右边缘执行「插入」，拖到中间区域执行「原地交换」，顺序、宽度、别名和首选供应商保存在当前浏览器中。
- **经典列表视图**：点击顶部「卡片 / 列表」切换回按供应商分组的搜索列表与渐变推理档位滑杆；动效遵循系统的「减少动态效果」设置。
- **记忆与状态**：成功选择的模型和思考强度会作为新会话默认；列表模式下切回本次页面期间使用过的模型会自动恢复它支持的上次档位。选择模型或调整档位后面板保持打开，加载失败提供重试，已保存但不可路由的模型会被标记且不能再次选中。
- 子代理会话不可用模型选择，与原生一致。

## 安装

```sh
dsh plugin --profile web add @klarkxy/dsh-model-picker
```

把 `web` 换成你的 profile 名，安装后重启 profile 即可替换输入框的模型按钮，无需额外配置。

与 `reasoning-slider` 同时安装时本插件生效；禁用或移除本插件后，按钮回退到之前的占用者——`reasoning-slider` 或原生按钮。

## 其他插件接入

功能插件可在自己的设置页或卡片里挂载同一选择器。接入是可选的：本插件缺席时各功能继续使用原有菜单，禁用或卸载不影响它们。接入契约见 `@klarkxy/dsh-model-route`。

## 主要限制

- 只覆盖输入框模型按钮与共享选择器；「设置 → 模型」页面保持原生布局。
- 卡片视图模式、宽度、排序、自定义简称与首选供应商保存在当前浏览器的 `localStorage` 中，不跨设备同步。
- 已保存但离开目录的模型仍显示，但标记为不可路由且不能再次选中。

## 许可证

[SATA License 2.1](LICENSE)
