# Offline同步增加aimodel开关

## 任务描述

用户要求现有sync:offline-update支持aimodel，随后指定通过-aimodel开关启用，默认无需同步模型。兼容--aimodel，单次/watch共用选项，复用既有模型同步模块，将镜像保存到静态同步根下aimodel，保留可再次提供下载的manifest.json。

## Design需求

见docs/design/android-offline-hot-update.md的2026-10-12方案，以及docs/design/ai-model-sync.md的镜像边界。不开关保持原流程与网络请求；父目录源开启后同步同级aimodel；直接aasc-offline源开启后同步其同级aimodel到本地更新目录旁。不会改独立sync:ai-models默认res/models目标。

## Spec设计

见docs/spec/android-offline-hot-update.md：布尔开关解析→资源目录映射→Offline/MMD原流程→共享模型同步→全部模型成功后原子保存模型清单→回显下载/复用。重复镜像复用模型并保持未变化清单；模型失败保留旧清单与已完成其他资源，watch下一轮继续。

## 受影响代码与模块

- scripts/ops/sync-offline-update.js：CLI开关、映射、共享模型调用及汇总。
- scripts/models/sync-ai-models.js：可选镜像清单保存与总量回报；独立默认行为保持。
- scripts/models/ai-model-common.js：镜像根manifest安全路径校验，不放宽清单内模型路径规则。
- tests/offline-update-sync.test.js、tests/ai-model-sync.test.js。
- package.json定向自测命令；design/spec/usage/self-test/todo/changelog。

## 自测用例

默认无aimodel请求；两种开关及重复/带值拒绝；父目录/直接服务目录映射；真实小模型下载、重复复用和镜像manifest；镜像可作为后续下载源；坏哈希/中断旧manifest保留；额外文件保留与符号链接拒绝；服务验签/清理范围及MMD保持；watch每轮显式模型同步、失败后继续、无开关不碰模型。

## 兼容性与性能

沿用现有Node与HTTP(S)代码，不新增生产依赖。不开关无约1GB额外传输，开启且文件一致时只读取清单并验证本地文件，不下载一致模型。不同时启动多轮或额外后台任务；Windows设备尚未单独实机验证。

## 风险与预计工时

风险中：同级目录映射、root manifest覆盖、清理边界和部分模型失败。使用独立aimodel根、清单最后原子保存、既有清理只作用于aasc-offline；模型规则与原子下载复用现有实现。预计30–60分钟，不执行生产目录的强制全量覆盖或重复跨WAN下载约1GB。

## 完成状态

用户已确认按方案实施。支持`-aimodel`、`--aimodel`、父/直接源目录和watch；模型与根清单镜像到目标同级`aimodel/`。未新增服务器配置接口，不改变APK模型使用范围或同步生产模型目录。

## 验证结果

使用项目内TMPDIR运行`npm run test:offline-sync`，33项通过，无失败/跳过。覆盖开关默认关闭、短/长写法、重复/带值拒绝、目录映射、模型镜像、重复同步、watch两轮复用、镜像可作为后续下载源、清单原子更新与失败保留。默认HTTP同步源`aimodel/manifest.json`此前已核对HTTP200，无重定向；未同步生产目录。
