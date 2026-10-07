# @klarkxy/dsh-model-hub

DeepSeek Harness 跨插件模型设置枢纽——**开发预览**。插件页通过宿主设置服务
列出并编辑可实时更新的模型路由字段，同时报告：

1. 已安装插件的 `settings.describe()` 投影里有哪些模型路由字段
   （通过 `@klarkxy/dsh-model-route` 检测，标记或裸形状均可）？
2. 自定义 schema 标记能否穿过宿主投影？本插件自己的 Config 带两个自检字段：
   一个用自定义 `x-model-route` 键标记，一个用 schemastery 渲染器 role 通道。

报告会写日志，并落盘到 `<profile>/data/model-hub/probe-report.json`，
每次 `settings/document-updated` 事件后刷新。

实际数组元素按数字索引显示为独立行。空集合显示提示行，需要先在所属插件中
添加元素再编辑。写入前重新检测宿主投影中的目标字段，并用描述符版本进行 CAS
校验。跟随默认模型保留数组元素，其他设置仍由所属插件维护。

两个自检字段各自声明 volatile，让宿主投影包含它们而不扩大普通配置的可见范围。
此预览尚不包含按天用量统计。

## 安装

需要 DSH 0.2.0-rc.2 或更高版本。安装预发布通道，重启 profile 后打开「插件 → 模型枢纽」：

```sh
dsh plugin --profile web add @klarkxy/dsh-model-hub@next
```

## 许可证

SEE LICENSE IN LICENSE
