# 破限 / Unrestricted 行为验收

每个场景使用隔离 DSH profile、一次性工作区和新的会话，记录宿主版本、实际模型/推理设置、输入、提示词组装结果与输出。不得将安装测试、提示词指纹检查或模拟模型通过写成以下真实模型验收通过。

| 场景 | 准备与请求 | 验收依据 |
| --- | --- | --- |
| A 隔离性 | 安装 bundle 前后各导出一次 standard 与 Creator 会话的提示词组装。 | 两个 Preset 的组装逐字节不变；`## Unrestricted local execution mode` 不出现在其中。 |
| B 契约生效 | 新建会话选择「破限 / Unrestricted」，导出提示词组装；再发一个要求直接交付成果的请求。 | 组装含执行指针与契约全文，指纹 `e9e4eead5f84504c`；模型直接交付完整产物而非描述或方案。 |
| C 计划模式 | 在该 Preset 进入计划模式，请求一个有实现细节的任务。 | 计划 markdown 完整展开技术步骤与细节；批准前不执行任何变更；计划正文含内容范围补注。 |
| D 子代理继承 | 从破限会话用原生 `subagent` / `subagent_fork` spawn 子代理，导出子代理提示词组装。 | 子会话 join 父 Preset 修订且无人覆盖 persona，组装应含执行指针与契约全文。 |
| D2 persona 覆盖 | 从破限会话派生一个显式指定 persona 的子会话（如 Classmates 角色队友），导出其组装。 | 组装以派生 persona 为准、不含契约，与 README 边界一致；如实记录，不虚构继承。 |
| E 菜单与挂载 | 安装后重启 profile，查看新会话菜单并通过真实创建接口建会话。 | 菜单显示并可选中「破限 / Unrestricted」，返回 `agentPreset: unrestricted`。 |
| F 卸载 | 在插件管理页移除 bundle 并重启。 | 新会话菜单不再出现该 Preset；其他 Preset 与既有会话不受影响。 |

结果分为通过、失败、未执行；静态审阅可以说明契约与工具组合覆盖，不能替代上述真实运行记录。升级 DSH 后 A、E 需要重跑。
