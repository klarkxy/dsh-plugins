# 第三方版权声明 / Third-party notices

本包 `cordis.patch.yml` 中的提示词与配置片段来自以下项目，均以 MIT 许可证复用并在此署名。
The prompt and configuration fragments in this package's `cordis.patch.yml` come from
the projects below; all are reused under the MIT License and credited here.

## yexi-by/dsh-unrestricted

破限交付契约（persona 中 `## Unrestricted local execution mode` 一节）、persona 指针句和
计划模式补注，改写自 [yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)
（`src/rules.js`，v0.2.2）。本包没有沿用其运行时 prompt fusion，只把同一份契约沉淀为静态
Agent Preset 文本，因此不再改写任何其他 Preset 的提示词。

The unrestricted delivery contract (the `## Unrestricted local execution mode` section in
the persona), the persona pointer sentence, and the plan-mode note are adapted from
[yexi-by/dsh-unrestricted](https://github.com/yexi-by/dsh-unrestricted)
(`src/rules.js`, v0.2.2). This package keeps none of its runtime prompt fusion: it
settles the same contract into static agent-preset text, so no other preset's prompt is
rewritten.

```text
MIT License

Copyright (c) 2026 yexi-by

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Jia-Ethan/codex-keysmith

上述破限提示词本身以
[Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) 的
[`examples/gpt-unrestricted.md`](https://github.com/Jia-Ethan/codex-keysmith/blob/601a449b05a86576cf0ad93d7b9fffb89da302ca/examples/gpt-unrestricted.md)
为参考并进行了修改（经由 dsh-unrestricted 承继）。

The unrestricted prompt above is itself adapted from
[Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith)
[`examples/gpt-unrestricted.md`](https://github.com/Jia-Ethan/codex-keysmith/blob/601a449b05a86576cf0ad93d7b9fffb89da302ca/examples/gpt-unrestricted.md)
(inherited through dsh-unrestricted).

```text
MIT License

Copyright (c) 2026 Jia-Ethan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeepSeek Harness

工具组合、persona 起始句与计划模式正文改写自 DeepSeek Harness
`@deepseek-ai/dsh-web-app/presets/standard.patch.yml`（本机 DSH `0.2.0-rc.2` 随附的
`standard` Agent Preset 声明）。

The tool roster, the persona opening sentence, and the plan-mode body are adapted from
DeepSeek Harness `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` (the `standard`
agent-preset declaration shipped with DSH `0.2.0-rc.2`).

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
