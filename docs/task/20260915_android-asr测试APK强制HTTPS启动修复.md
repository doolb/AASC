# Android ASR 测试 APK 强制 HTTPS 启动修复

## 任务描述

修复独立 Android ASR 测试 APK 在模型和 TLS 证书仍处于后台加载阶段时启动服务，导致服务捕获空 `SSLContext` 并静默降级为明文 HTTP 的问题。生产测试网页必须始终通过 HTTPS 提供，JVM 明文 HTTP 回归测试通过显式测试参数保留。

## Design 需求

- `MainActivity` 在 TLS 证书就绪前禁用服务按钮，并在点击处理再次校验。
- `AsrHttpServer` 默认拒绝空 TLS 上下文，不创建明文服务端 socket。
- 明文 HTTP 只能由 JVM 测试显式开启，不能从生产 APK 的 `MainActivity` 传入。
- 证书加载失败时显示未就绪原因；已启动的明文旧进程必须停止并重新启动才能切换为 HTTPS。

## Spec 设计

- `tlsContext` 初始为空，TLS 资源加载成功后才允许启动服务。
- `AsrHttpServer.start` 在安全默认路径下先校验 TLS，再创建 `SSLServerSocket`。
- 服务启动成功时地址协议与 socket 类型一致，生产地址必须是 `https://`。

## 受影响的功能模块和代码

- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/AsrHttpServer.kt`
- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/MainActivity.kt`
- `3rd/tts-server/android-asr/app/src/main/res/layout/activity_main.xml`
- `3rd/tts-server/android-asr/app/src/main/res/values/strings.xml`
- `3rd/tts-server/android-asr/app/src/test/java/com/aasc/asr/AsrHttpServerTest.kt`
- `tests/android-asr-apk.test.js`
- `docs/design/android-voiceprint-test-apk.md`
- `docs/spec/android-voiceprint-test-apk.md`
- `docs/task/20260915_android-asr测试APK强制HTTPS启动修复.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

1. 默认传入空 TLS 上下文时，`AsrHttpServer.start(0)` 返回失败，不监听明文端口。
2. JVM 测试显式开启明文兼容后，既有 `/`、`/health`、声纹接口仍返回 HTTP 结果。
3. TLS 上下文存在时，服务地址以 `https://` 开头，使用 `SSLServerSocket` 接受连接。
4. APK 初始加载期间 HTTPS 服务按钮不可用；TLS 就绪后按钮可用。
5. 证书加载完成前发生点击竞态时，服务仍拒绝启动，不产生 `http://` 地址。
6. APK 构建后仍包含 `assets/tls/android-asr-cert.pem` 和 `assets/tls/android-asr-key.pem`。
7. 真机上 HTTPS `/health` 返回 200，HTTP 明文请求被重置或无法建立连接。

## 兼容性测试

- Android 9/API 28、arm64-v8a 真机。
- 保持现有普通 ASR、声纹、流式 ASR、网页路由和模型资源不变。
- JVM 测试继续覆盖明文协议，但必须显式声明测试用途。
- 自签名证书继续要求浏览器首次信任或跳过证书告警。

## 性能测试

- 不增加模型推理和网络请求；只增加一次状态判断和按钮状态刷新。
- HTTPS socket 创建仍使用现有 `SSLContext` 和线程池。
- 服务启动前的证书等待不会阻塞主线程，模型加载仍在后台线程执行。

## 风险评估

- 模型或证书加载失败时服务按钮会保持不可用，属于安全优先的显式失败行为。
- 依赖旧明文 JVM 测试的调用方需要显式传入测试开关；生产调用方不受影响。
- 已经运行的旧明文实例不会热切换，需要停止后重新启动；状态提示会明确显示当前协议。

## 预计工时

- 伪代码和任务文档：0.5 小时
- 回归测试：0.5 小时
- Kotlin 状态保护与文案：1 小时
- Android 构建和真机 HTTPS 验证：1 小时

## 当前状态

- ✅ 已完成：代码、回归测试、Debug APK 构建和 Android 9 真机 HTTPS 验收均通过。

## 实际实现与验证结果

- `AsrHttpServer.kt` 增加 `allowInsecureHttp` 测试开关，默认值为 `false`；生产调用在 `tlsContext` 为空时直接失败，不创建明文 `ServerSocket`。
- `MainActivity.kt`、`activity_main.xml` 和 `strings.xml` 在 TLS 资源加载完成前禁用服务按钮，点击入口再次校验，并统一显示 HTTPS 状态；证书加载失败时保留禁用状态并展示原因。
- `AsrHttpServerTest.kt` 新增空 TLS 默认拒绝回归测试，原有 JVM 明文测试全部显式传入 `allowInsecureHttp=true`。
- `tests/android-asr-apk.test.js` 增加 HTTPS 就绪文案和按钮状态契约检查。
- 验证命令及结果：
  - `npm --prefix 3rd/tts-server run build:android-asr -- --no-daemon`：Debug APK 构建成功。
  - `cd 3rd/tts-server && ../../src/apps/android-display/gradlew -p android-asr :app:testDebugUnitTest --no-daemon`：Android JVM 单元测试通过。
  - `node --test tests/android-asr*.test.js`：17/17 通过。
  - APK 内包含 `assets/tls/android-asr-cert.pem` 和 `assets/tls/android-asr-key.pem`。
  - 真机 `192.168.1.6:5555` 安装后，加载期间按钮为 `enabled=false`；模型/证书就绪后显示 `HTTPS 服务已就绪：可启动服务`；启动地址为 `https://192.168.1.6:18080`。
  - 真机 `curl -k https://192.168.1.6:18080/health` 返回 `200`；同端口 HTTP 请求被连接重置；应用进程无崩溃日志。
