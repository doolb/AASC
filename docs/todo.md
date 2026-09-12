# Web MediaCenter - 未完成任务列表

## 控制端

- ⏳可选任务 [2026-08-31] 能力拆分为内置任务或用户任务
  - 候选：天气查询、媒体搜索/播放、提醒管理、显示端控制、TTS 生成、系统诊断、RSS/数据处理和自定义工作流。
  - 建议优先级：`weather.query` → `media.search` → `reminder.*` → `display.control`。
  - 当前仅登记方案，暂不实现，也不创建对应任务实例。

- ⏳待处理 [2026-08-30] Pi Agent 主动压缩上下文
  - Pi AgentSession 自带上下文压缩能力，当前 PiRuntimeManager 暂不封装手动压缩入口和自动阈值触发；保留后续增加控制端按钮或按上下文占用触发的需求。
  - 关联任务：`docs/task/2026-08-30_Pi主动压缩暂不实现.md`。

- ⏳待处理 [2026-08-30] 群聊统一历史中的旧工具调用异常文本
  - 现象：未指定角色的群聊使用 `group/default` 历史时，可能收到并播报 `[Error: write after end]`。
  - 疑似来源：旧 Pi Agent/工具调用流程遗留的未闭合 Chat2API 工具调用记录；当前历史中存在 `profileName=qwen3.5`、`templateId=default` 的异常内容，具体产生流程待后续确认。
  - 已完成当前 Chat2API canonical 工具标签解析残留修复；历史中已经保存的异常消息和 `write after end` 清理仍暂不处理。
- 处理决定：仅记录，暂不修改代码、历史文件或 TTS 行为。
  - 关联任务：`docs/task/2026-08-30_群聊历史遗留工具调用异常.md`。

## Android ASR APK

- ⏳待现场验收 [2026-09-11] 在独立 ASR 测试 APK 原生页面使用测试 WAV 完成 Sherpa 声纹注册和三种测试模式回归
  - APK 已构建、安装和启动；设备 UI 自动化桥返回空 root，尚未自动完成注册、单段、多段、快速多段及双降噪开关的点击验证。
  - 2026-09-12 已通过同一 APK 的 HTTPS 测试页面完成三个模型/FP32-INT8 的单段和普通分段回归；原生页面按钮链路仍待单独现场点击验收。
  - 相关实现：`docs/design/android-voiceprint-test-apk.md`；`docs/spec/android-voiceprint-test-apk.md`；`docs/task/2026-09-11_ASR测试APK原生页面接入Sherpa声纹UI.md`。

## TTS

## 文本媒体

## 聊天系统

- ⏳可选任务 [2026-09-01] 自动测试请求级聊天隔离
  - 当前自动测试仍可能连接现有服务器并写入真实群聊；聊天历史持久化已先增加防误删保护。
  - 后续可增加 `testOnly/testRunId` 临时会话命名空间，禁止测试持久化 AASC、Pi 和 Responses 历史。

- ⏳待处理 [2026-08-31] 控制端无 `displayId` 时无法启动普通 Pi Agent 聊天
  - 现象：控制端发送 `chatMessage` 且不带 `displayId` 时，服务端回退处理因缺少显示端上下文提前返回，不产生 `chatChunk` 或 `chatResponse`。
  - 当前带已连接显示端 ID 的控制端流程正常；后续需将普通聊天处理从显示端上下文门控中拆出，支持无显示端的控制端会话。

- ⏳待处理 [2026-08-31] `commandMode` 开关当前未使用
  - 现代显示端的 `waitingWake` 由会话状态门控过滤，`activeGroup` 和 `activePrivate` 会绕过该过滤；当前开关只保留配置、控制端同步和旧调用路径兼容。
  - 暂不删除或重定义，后续再决定是否移除，或改为控制 Agent 系统工具权限。

- ⏳待讨论 [2026-08-31] 私聊聊天 Agent 调用受限系统工具
  - 设计文档：`docs/design/private-chat-agent-tools.md`；当前只记录方案，不实现代码。
  - 待确认工具确认策略、静音是否包含取消静音、切换助手后的历史/session 规则，以及 Pi/Codex 统一工具协议。

## 开发工具

## 媒体播放

## AI 角色

## Android APK

- ⏳待现场验收 [2026-09-08] 完成 APK 内置 Node.js 子服务器的生产依赖打包和真机业务验收
  - Node Runtime、安装器、Service、主服务器主动连接和能力裁剪已实现；构建时仍需显式提供 Android 可用的 arm64 Node Runtime 和生产 `node_modules`。
  - 待用完整生产包安装 APK，验收 server-app 启动、AASC 注册、媒体库浏览/上传/直连播放和热更新。
  - 设计：`docs/design/android-embedded-node-server.md`；实现伪代码：`docs/spec/android-embedded-node-server.md`；任务：`docs/task/20260908_APK内置Node.js子服务器.md`。

- ⏳待处理 [2026-09-03] 明确 DeX 多屏控制模式触摸/滚轮输入契约
  - 当前 `tests/display-native-bridge.test.js` 仍保留原生 `injectTouch`/`injectWheel` 断言并产生已知失败；本次按要求暂不处理，后续确认恢复原生注入还是补充独立的目标显示输入方案。

- ⏳可选任务 [2026-09-02] 为 Android YOLO11 测试 APK 增加带标注验证集的准确率评估
  - 当前已记录 `bus.jpg` 单图定性结果；正式 Precision、Recall、mAP 需要目标场景的图片和标注数据。

- ⏳待处理 [2026-09-01] 将 Termux 服务器试运行整理为正式 Android 节点
  - 当前 `~/aasc-server-test` 已能在 Termux 以 runit 服务运行，使用 8081 端口；服务器发布包现由 `npm run build:server-package` 显式生成，主服务器媒体索引聚合、远程媒体直连优先/代理回退、控制端媒体写入、APK 子服务器重启恢复和节点就绪后的正常播放重播已完成，后续仍需认证和完整 Android 生产包现场验收。
  - 当前 ASR、TTS Wine、Puppeteer 暂不迁移；正式节点需要在配置和控制端明确不可用能力。

- ⏳待处理 [2026-08-25] 修复 APK 原生 ASR 识别结果为空及声纹 native 崩溃
  - 真机 `NativeDisplay.asrRecognize()` 对有效 PCM 返回 `{}`，`/api/asr/recognize` 连续 5 次全部失败；调试声纹匹配时 `VoiceprintEngine.match` native 崩溃导致 APK 进程退出。
  - 2026-08-27 对照测试：WeSpeaker 单段和 Sherpa 两种流程均可返回文字/声纹；WeSpeaker 多段滑窗 embedding 在四个音频上均触发 OOM，即使不加载 ASR 模型仍复现。
  - 2026-08-27 独立测试 APK 已移除 WeSpeaker 测试，当前验收范围仅保留 Sherpa 单段/多段；WeSpeaker 多次 embedding 的 OOM 不再阻塞该 APK。
  - 仍需继续定位生产显示端原生桥异常/结果日志，修复后再完成速度、P95 和长稳内存压测。

## AASC 网络

- ⏳待处理 [2026-09-05] 设计并实现 AASC 权限认证
  - 在节点注册、媒体索引和任务路由稳定后，再增加用户、节点、媒体库和操作权限。

## 批量播放模式

# 当前任务

## 控制端语音配置

- ⏳待处理 [2026-08-31] active 群聊/私聊中的其他指令按普通聊天发送
  - 当前仅“搜索”已改为 active 会话普通聊天；天气、提醒、播放、静音、报时、录音及其他自定义指令仍按现有命令优先级处理。
  - 后续逐项确认并调整，等待唤醒状态的免唤醒命令规则暂不改变。
  - 当前三种语音会话状态的使用说明见 `docs/usage/voice-conversation.md`。

# Android 显示端音频

## 外部应用焦点

## TTS 播放
