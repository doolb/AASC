# 聊天 TTS 打断与 Offline 定时更新

## 任务描述

在显示端聊天/角色入口后增加当前聊天 TTS 停止按钮；新聊天回复打断旧回复播报，思维链切换为正常答案时停止思维链播报。Offline APK 增加前台 10 分钟更新检查，并保留启动/恢复检查。

## design 需求

- 采用聊天会话 ID 和 `think`/`answer` 阶段标记，不误停媒体、报时或其他聊天会话。
- 服务端异步生成结果必须进行代次校验，避免旧音频迟到。
- 更新轮询只在 Activity 前台运行，点击“稍后”不丢失候选版本。

## spec 设计

- 更新 `docs/spec/chat-tts-interruption-and-offline-update.md` 中的会话 TTS 与更新轮询伪代码。
- 更新 think 流式解析伪代码，使句子带有播报阶段。

## 受影响功能模块和代码

- Web 显示端：`display.html`、`display-stage.js`、`display-chat.js`、`chat.js`、`websocket.js`。
- 服务端：`server-app.js`、`agent-chat-tts.js`、`llm-service.js`、`think-output-filter.js`。
- Android Offline：`MainActivity.kt`。
- 测试：聊天 think/TTS、显示端聊天、Offline 更新和 Android 静态契约测试。

## 自测用例

1. 显示端停止按钮清空当前聊天会话的播放中和排队 TTS，媒体/报时 TTS 不受影响。
2. 连续发送两条聊天消息，第一条迟到的音频不播放，第二条按顺序播放。
3. `<think>思考。</think>答案。` 的思考音频在答案阶段开始时停止，答案立即播放。
4. 控制端播放模式同样能清空旧会话音频。
5. Offline 前台启动立即检查，10 分钟后再次检查；后台不持续调度，恢复前台后重新检查。
6. 旧版不带会话字段的 TTS 和普通全局停止保持兼容。

## 兼容性测试

- Node 定向聊天/TTS/显示端契约测试。
- Android `:app:testDebugUnitTest`。
- Offline APK 静态回归和 `git diff --check`。

## 性能测试

- TTS 生成线程不增加并发数；旧代次结果只在发送前丢弃。
- 更新检查最多每 10 分钟一次，Activity 不可见时不运行网络检查。

## 风险评估

- 旧异步 TTS 已经生成但在途时仍可能占用生成资源，但不会播放；通过代次检查防止声音串台。
- 显示端和控制端需要同时识别新的停止字段；未知字段仍由旧逻辑安全忽略。
- 若服务端离线，显示端本地停止仍立即生效。

## 预计工时

约 2 小时，包含协议调整、Android 轮询、定向测试和文档同步。

## 执行状态

已完成。

## 实际执行结果

- 服务端完成聊天 TTS 会话代次、`think`/`answer` 阶段标记和异步旧结果失效保护。
- 显示端增加“停止播报”按钮；显示端和控制端均可只清理当前聊天会话的排队/播放中 TTS。
- 新聊天消息会先停止上一轮当前会话播报；答案阶段开始时只停止思维链播报。
- Offline APK 前台启动/恢复立即检查，Activity 前台每 10 分钟检查一次；暂停和销毁时移除定时回调。
- 新增 `tests/chat-tts-interruption.test.js`，并补充 `tests/chat-think-filter.test.js` 的阶段断言。
- 使用 `npm run build:apk:offline:min`（复用 `/mnt/AASC/build/third_party/MNN` checkout）生成并发布 `allserver-min` v24；文件大小 `89264782` bytes，SHA-256 为 `faed86143a39eff7fa398b2815b9952e35867c68d5776cd0d9a565cec195c7b6`。
- 生成并发布 code-only v14；文件大小 `15173599` bytes，SHA-256 为 `a0fd191e9d9b2eeabb9e56807b0c6715818cd5e60f9b31c518b085b6d5f6aa8d`，复用 dependencies v4。
- code v14、dependencies v4、min v24 已同步到 LAN `/mnt/aasc-offline` 和 WAN `as@120.79.245.103:~/a/aasc-offline`；两端清单版本、签名、HTTP Content-Length、远端 SHA-256 和精确清理均通过。
- v24 APK 已通过 ADB 覆盖安装到 `192.168.1.6:5555`，保留原有应用数据；包 `com.aasc.display.offline` v24 启动成功并显示 `MainActivity`。

## 验证结果

- Node 定向回归：60/60 通过。
- Android `:app:testDebugUnitTest`：182/182 通过，0 failures，0 errors。
- 修改文件 JavaScript 语法检查通过，`git diff --check` 通过。

## 遗留风险

- 旧代次 TTS 在取消后可能仍短暂占用生成线程，但不会再发送或播放。
- 本次未改变 APK 下载、验签、安装和回滚流程；已在一台 ADB 真机启动 v24，但未等待完整 10 分钟周期。
