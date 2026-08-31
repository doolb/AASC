# Web MediaCenter - 未完成任务列表

添加修复模式，调用工作者对话，需要输入密码进入

## 控制端

- ⏳可选任务 [2026-08-31] 能力拆分为内置任务或用户任务
  - 候选：天气查询、媒体搜索/播放、提醒管理、显示端控制、TTS 生成、系统诊断、RSS/数据处理和自定义工作流。
  - 建议优先级：`weather.query` → `media.search` → `reminder.*` → `display.control`。
  - 当前仅登记方案，暂不实现，也不创建对应任务实例。

- ⏳待处理 [2026-08-30] Pi Agent 主动压缩上下文
  - Pi RPC 原生支持 `compact`，当前 PiRuntimeManager 暂不封装手动压缩入口和自动阈值触发；保留后续增加控制端按钮或按上下文占用触发的需求。
  - 关联任务：`docs/task/2026-08-30_Pi主动压缩暂不实现.md`。

- ⏳待处理 [2026-08-30] 群聊统一历史中的旧工具调用异常文本
  - 现象：未指定角色的群聊使用 `group/default` 历史时，可能收到并播报 `[Error: write after end]`。
  - 疑似来源：旧 Pi Agent/工具调用流程遗留的未闭合 Chat2API 工具调用记录；当前历史中存在 `profileName=qwen3.5`、`templateId=default` 的异常内容，具体产生流程待后续确认。
  - 处理决定：仅记录，暂不修改代码、历史文件或 TTS 行为。
  - 关联任务：`docs/task/2026-08-30_群聊历史遗留工具调用异常.md`。

## Android ASR APK

## TTS

## 文本媒体

## 聊天系统

## 开发工具

## 媒体播放

## AI 角色

## Android APK

- ⏳待处理 [2026-08-25] 修复 APK 原生 ASR 识别结果为空及声纹 native 崩溃
  - 真机 `NativeDisplay.asrRecognize()` 对有效 PCM 返回 `{}`，`/api/asr/recognize` 连续 5 次全部失败；调试声纹匹配时 `VoiceprintEngine.match` native 崩溃导致 APK 进程退出。
  - 2026-08-27 对照测试：WeSpeaker 单段和 Sherpa 两种流程均可返回文字/声纹；WeSpeaker 多段滑窗 embedding 在四个音频上均触发 OOM，即使不加载 ASR 模型仍复现。
  - 2026-08-27 独立测试 APK 已移除 WeSpeaker 测试，当前验收范围仅保留 Sherpa 单段/多段；WeSpeaker 多次 embedding 的 OOM 不再阻塞该 APK。
  - 仍需继续定位生产显示端原生桥异常/结果日志，修复后再完成速度、P95 和长稳内存压测。

## 批量播放模式

# 当前任务

## 控制端语音配置

# Android 显示端音频

## 外部应用焦点

## TTS 播放
