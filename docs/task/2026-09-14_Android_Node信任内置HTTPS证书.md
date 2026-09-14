# Android Node 子服务器信任 APK 内置 HTTPS 证书

## 任务描述

offline APK 当前聊天配置为 `https://127.0.0.1:8081/v1` 时，直接请求 `/v1/responses` 可以工作，但控制端通过 WebSocket 发送聊天消息会由 Node 子服务器内部发起 HTTPS Responses 请求，并因 Node.js 默认不信任 APK 自签名证书而失败。需要让 APK 内的 Node 子进程信任随包提供的 `res/certs/cert.pem`，重新打包安装并在 display 2 完成聊天、ASR、TTS 回归。

## Design 需求

- 复用 APK 已打包的 `res/certs/cert.pem`，不复制到外部存储，也不关闭全局 TLS 校验。
- Android `NodeServerService` 启动 Node 子进程时，通过 `NODE_EXTRA_CA_CERTS` 注入证书路径。
- 证书路径不存在时不注入变量，避免非证书构建产生无效环境变量告警。
- 保持运行配置 `https://127.0.0.1:8081/v1`，并验证证书 SAN 覆盖 `127.0.0.1`。

## Spec 设计（伪代码）

```text
NodeServerService.buildNodeEnvironment(rootDir, serverUrl, serverVersion)
    → 初始化 HOME、LD_LIBRARY_PATH、OPENSSL_CONF 和 AASC 运行环境
    → 计算 rootDir/res/certs/cert.pem
    → 如果证书文件存在，将 NODE_EXTRA_CA_CERTS 设置为该文件绝对路径
    → 如果证书文件不存在，不写入 NODE_EXTRA_CA_CERTS
    → ProcessBuilder 启动 Node launcher
    → Node 进程启动时读取 NODE_EXTRA_CA_CERTS
    → Node HTTPS 客户端访问 https://127.0.0.1:8081/v1 时信任 APK 内置证书，并继续校验主机名
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt`
  - 为 Node 子进程增加内置证书环境变量。
- `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerServiceTest.kt`
  - 增加证书存在时环境变量注入和证书缺失时不注入的回归测试。
- `docs/design/android-embedded-node-server.md`
- `docs/spec/android-embedded-node-server.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. Gradle `testDebugUnitTest`：证书存在时注入正确绝对路径，证书缺失时不注入。
2. 重新构建 offline APK，确认 APK 内包含 `res/certs/cert.pem`。
3. 安装到 `192.168.1.6:5555` 的 display 2，确认 Node 服务监听 8081。
4. 使用当前 `https://127.0.0.1:8081/v1` 配置，通过控制端 WebSocket 发送聊天消息，确认返回 `chatResponse` 成功。
5. 使用测试 WAV 验证 ASR 返回文本。
6. 生成 TTS 音频并验证音频 URL 返回 HTTP 200 和 `audio/wav`。

## 兼容性测试

- Android 9/API 28、arm64-v8a：本次真机目标设备 SM-N9500。
- 无证书的 Node 运行目录：不设置 `NODE_EXTRA_CA_CERTS`，保持原有启动行为。
- HTTP/HTTPS：不改变服务端监听协议，只为 HTTPS 客户端补充 APK 内置 CA。

## 性能测试

- 环境变量注入是进程启动时的一次字符串赋值，不增加请求路径上的文件复制或证书计算。
- 重新启动后复测 Node 启动和 Responses 请求耗时，确认无明显回归。

## 风险评估

- 风险：证书路径或 APK 资源缺失会导致 HTTPS 请求继续失败；通过缺失分支测试和 APK 内容检查降低风险。
- 风险：证书只作为 Node 子进程的额外 CA，不应通过 `NODE_TLS_REJECT_UNAUTHORIZED=0` 关闭主机名校验；通过 SAN 检查和真实 HTTPS 请求验证。
- 风险：安装 APK 可能触发 Runtime 重新安装并占用较大存储；使用现有设备空间检查和可恢复的 `adb install -r` 流程。

## 预计工时

- 方案和文档：0.5 小时
- 回归测试与实现：0.5 小时
- APK 构建、安装和真机回归：1 小时

## 执行结果

- 已完成 `NodeServerService` 的环境变量注入和 Android 单元回归测试。
- 证书 SAN 已确认包含 `127.0.0.1`；APK 已包含 `assets/res/certs/cert.pem` 和默认 MNNChat 模型完整文件。
- APK 构建成功，产物为 `src/apps/android-display/app/build/outputs/apk/offline/aasc-display-offline.apk`，SHA-256 为 `67cddb9dad162637dc27582e5bd4a01214453ef5ab0158c45da92ca22d313f04`。
- 设备 `192.168.1.6:5555`（Samsung SM-N9500，Android 9/API 28）安装成功并运行于 display 2；实际 Node 进程环境包含 `NODE_EXTRA_CA_CERTS=/data/user/0/com.aasc.display.offline/files/aasc-server/res/certs/cert.pem`。
- 设备配置保持 `https://127.0.0.1:8081/v1`，默认模型为 `qwen3.5-0.8b-claude-opus-distilled-mnn`。
- 聊天 WebSocket 回归返回 `chatResponse success:true`，收到 108 个 `chatChunk`，服务端日志确认走 `protocol:"responses"`；ASR 返回“你好，小爱。”且 HTTP 200；TTS 生成 WAV 且音频 URL HTTP 200、`Content-Type: audio/wav`。
- Gradle `:app:testDebugUnitTest`：134/134 通过；`npm test`：727 项中 726 项通过，唯一失败为已有的 Windows 输入声纹配置契约，不属于本任务。
