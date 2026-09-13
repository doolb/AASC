# Android MNNChat 能力开关与 ModelScope 模型目录
## 执行状态

实现已完成；显示端能力开关、ModelScope 清单代理和前端/路由契约测试已通过，真实 APK 下载与长稳推理仍纳入现场验收任务。

## 任务描述

为显示端能力设置增加本地 LLM 开关，并参考 MNNChat 官方模型目录，将可用的 MNN-LLM 模型通过 ModelScope 提供给 APK 按当前选择下载。保持每个 APK 单模型、无默认模型、切换等待当前推理完成和目标不可用不回退的既定约束。

## design 需求

- 能力设置保存 `capabilities.llm.enabled`，不覆盖 APK 原生 `supported`、`ready` 和模型状态。
- 关闭 LLM 的显示端不进入本地 LLM 路由池，也不能接受模型切换。
- 模型目录参考 MNNChat `assets/model_market.json`；AASC 只发布具备逐文件大小和 SHA-256 的 MNN-LLM 模型。
- 服务端固定代理 ModelScope 仓库的 `resolve` 文件地址，不接受客户端任意上游 URL。

## spec 设计

```text
normalizeDisplayCapabilities(reported, userOverrides):
  merge scalar display capabilities
  preserve native llm.supported/ready/selectedModelId
  apply only boolean userOverrides.llm.enabled
  missing llm.enabled => true
  return authoritative capabilities

resolveLlmModel(modelId, filename):
  require modelId and filename in manifest
  require source.provider == "modelscope"
  build URL from fixed repository + revision + basename
  proxy response to APK
  APK verifies declared size and sha256 before atomic install
```

## 受影响功能和代码

- `src/apps/web-mediacenter/ui/public/js/device-list.js`：能力编辑器、LLM 卡片和状态显示。
- `src/apps/web-mediacenter/ui/public/display.html`：保留服务端 LLM 开关，避免原生状态回报覆盖配置。
- `src/apps/server/boot/server-app.js`：能力规范化、持久化、路由开关和模型切换校验。
- `src/apps/server/modules/llm/llm-router.js`：过滤关闭 LLM 的显示端。
- `src/apps/server/modules/llm/llm-model-manifest-service.js`：ModelScope 远端文件元数据和白名单代理。
- `res/models/llm/manifest.json`：MNNChat 目录中的可下载模型及 ModelScope 文件校验信息。
- `tests/display-list-voice-status.test.js`、`tests/llm-local-routing.test.js`：前端和路由契约回归。

## 自测用例

- 能力设置显示并保存“本地 LLM”开关，重连后仍保持关闭。
- 关闭开关后显示端不进入自动/显式 LLM 路由池，模型选择返回明确错误。
- 原生 `llm.status` 后到达时不覆盖 `llm.enabled`。
- ModelScope 模型清单包含固定仓库、revision、文件大小和 SHA-256。
- APK 只下载选择的模型，文件校验失败时不替换旧模型。
- 无实际 ModelScope 网络或无模型时，旧媒体、ASR、TTS 功能保持正常。

## 兼容性测试

- 旧显示端不包含 `llm.enabled` 时按启用处理。
- 不支持 MNN-LLM 的 APK 仍显示原生能力不可用。
- ModelScope 远端目录不可达时模型切换失败，不回退主服务器推理。

## 性能测试

- 检查 ModelScope 大文件代理不将完整模型读入服务端内存。
- 检查多次状态广播和能力切换不产生重复下载或重复加载。
- 记录模型下载、校验、加载和首 token 时间。

## 风险评估

- ModelScope 仓库文件可能变更；固定 revision、逐文件 SHA-256 和 manifest 白名单降低漂移风险。
- ModelScope 代理依赖外网可达；下载失败只影响当前模型，不改变既有 ASR/TTS。
- 远端模型可能与固定 MNN revision 不兼容；只发布已验证模型，加载失败保留旧模型。

## 预计工时

约 4–8 小时，包含定向测试和静态检查；不包含真实 APK 下载大模型和长稳推理验收。
