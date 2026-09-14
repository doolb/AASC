# Chat2API 合并入口与 Offline APK 语音默认重打包验证

## 任务描述

其他 Codex 已将 Chat2API 合并入口加入当前源码；本任务确认是否需要重新打包，并将最新服务器源码、生产依赖和离线模型重新打入 offline APK。APK 默认关闭服务器 ASR/TTS，改由显示端原生能力处理，同时保持语音监听默认开启。

## design 需求

- 使用 `docs/design/android-embedded-node-server.md` 的 APK 运行包输入边界。
- 使用 `docs/design/android-chat2api-login-control.md` 的 Chat2API 控制端和本地 `/api/chat2api` 入口设计。
- `AASC_ANDROID_NODE_PACKAGE_DIR` 必须同时包含当前 `src/` 和 Android 可用的生产 `node_modules`；只解包源码发布包不能作为完整 APK 运行包。
- offline APK 使用本地 HTTPS `https://127.0.0.1:8081`，ASR/TTS 生成设备为 `display`，服务器 ASR/TTS 均关闭。

## spec 设计

- 构建服务器发布包，解包到独立输入目录，再合并生产 `node_modules`。
- 在 APK assets 中检查 Chat2API 手动账号服务、控制端脚本和 `express` 依赖。
- 安装器完成 Runtime 内容指纹校验和私有目录 staging 后，启动本地 Node server-app。
- 通过 `/api/config/serverVoice`、`/api/config/ttsDevice`、`/api/asr/status` 验证语音配置和显示端能力。
- 通过 `/v1/chat/completions`、`/v1/responses`、`/api/tts/generate` 和 `/api/asr/recognize` 验证本地协议。

## 受影响的功能模块和代码

- 打包输入：`scripts/ops/build-server-package.js`、`scripts/ops/prepare-android-node-runtime.js`、Android Gradle offline 产物。
- Chat2API 运行包：`src/apps/server/modules/chat2api/`、`src/apps/web-mediacenter/ui/public/js/chat2api.js`。
- APK 语音路由：`src/apps/server/boot/server-app.js`、`src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerConfig.kt`、`NodeServerService.kt`、`display.html`。
- 文档：对应 design/spec、`docs/todo.md`、`changelog.md`。

## 自测用例

- `npm run check:chat2api` 通过，84/84。
- Android offline 相关静态回归通过，25/25；`git diff --check` 通过。
- APK 内包含 `chat2api-manual-account-service.js`、`chat2api.js` 和 `express`。
- SM-N9500 Android 9/API 28 设备以 Display 2 启动 `com.aasc.display.offline`，Node Runtime 首次解包完成并注册显示端。
- `/api/config/serverVoice` 返回 `asrEnabled=false`、`ttsEnabled=false`、`asrDevice=display`、`ttsDevice=display`。
- `/api/asr/status` 返回 `ready=true`、`device=display`、`serverEnabled=false`。
- Chat Completions 与 Responses 本地请求返回 HTTP 200，模型为 `qwen3.5-0.8b-claude-opus-distilled-mnn`。
- TTS 生成成功并返回 WAV 地址；ASR 使用 `你好，小爱.wav` 成功识别为“你好，小爱。”。
- 控制端按钮默认显示，UI 自动化可见文本“控制端”。

## 兼容性测试

- APK 包名：`com.aasc.display.offline`。
- 设备：Samsung SM-N9500，Android 9/API 28，ADB `192.168.1.6:5555`。
- 启动目标：Display 2；本地 Node HTTPS 端口 8081。
- 保留普通 APK 的服务端授权逻辑；本次未进行真实 Provider 登录，不写入真实账号凭据。
- Android 10/11+ SAF 媒体库和真实 Provider 登录不属于本次完成范围。

## 性能测试

- 首次安装需要解包约 1 GB 级 APK 内容；本次设备低剩余空间场景已清理 offline 应用自身 staging 后重新安装成功。
- Node Runtime 安装完成后复用内容版本，不在本任务中重复测量冷启动 P95。
- ASR 端到端测试返回 `asrElapsedMs=10089`，仅作设备基线记录，不作为性能优化验收。

## 风险评估

- 服务器发布 tar 不携带生产依赖，误用会在设备启动时触发 `Cannot find module 'express'`；已在构建输入规范和 APK 内容检查中固定要求。
- 设备存储不足会导致 staging 解包失败；本次只清理 offline APK 自身生成的运行目录和 staging 目录，未删除在线 APK 或用户模型。
- 服务器 ASR/TTS 关闭后，显示端原生能力不可用会直接返回结构化错误；需确保显示端能力通过 WebSocket 正确上报。
- Chat2API 真实 Provider 凭据和外部网页登录仍需现场账号验收。

## 预计工时

约 1.5 小时，包括源码包生成、生产依赖合并、APK 构建、设备安装、聊天/语音回归和文档同步。

## 实际执行结果

- 服务器包：`npm run build:server-package` 成功，随后补入生产 `node_modules`；最终输入包含 Chat2API 合并入口和 Express 依赖。
- APK：`build:apk:offline` 成功；APK SHA-256 为 `caedc0638a5fc321e0da0ee814a78e51ba8a4052c794bbb241ace8f2f6e1a471`。
- Runtime：内容版本 `content-0f9ddf7c48c405898c532480`，设备首次解包、Node 启动和本地 display 连接成功。
- 设备：offline APK 已卸载重装并在 Display 2 运行；本地控制页 HTTP 200，控制端入口默认可见。
- 业务：Chat Completions、Responses、显示端 TTS、显示端 ASR 均已成功验证。
