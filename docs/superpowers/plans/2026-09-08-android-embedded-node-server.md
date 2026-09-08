# APK 内置 Node.js 子服务器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `apk-display` 变成无需 Termux 的 Android AASC 子服务器节点，同时让 WebView 显示端继续连接主服务器 `/display`。

**Architecture:** 构建阶段准备 arm64 Node.js Android Runtime 和 AASC 服务器运行包，Gradle 将生成 assets 打入 APK。Android 前台 `NodeServerService` 启动独立的 Node.js `server-launcher.js`，launcher fork `server-app.js`；Node 服务以 `subserver` 角色主动连接主服务器 `/server`，MainActivity 的 WebView 仍加载主服务器 `/display`。通过 Android 节点能力策略关闭 ASR 隔离、Wine、Puppeteer、外部 CLI 和其他可选子进程，只保留服务基础双进程、HTTP/HTTPS、WebSocket 和媒体库。

**Tech Stack:** Kotlin、Android Service、Gradle Kotlin DSL、Node.js、Express、WebSocket、Node `node:test`、JUnit4。

**Spec:** `docs/superpowers/specs/2026-09-08-android-embedded-node-server-design.md`

## Global Constraints

- 只支持 `arm64-v8a` 和 Android API 26+，与当前 `src/apps/android-display/app/build.gradle.kts` 保持一致。
- APK 不依赖 Termux、systemd、runit、Wine、Puppeteer 浏览器或 Linux 桌面。
- `server-launcher.js` → `server-app.js` 是必须保留的基础双进程；“禁用子进程”只针对可选任务和外部服务。
- WebView 永远加载用户配置的主服务器 `/display`，不得改为 `127.0.0.1` 或子服务器 `advertisedUrl`。
- 子服务器通过现有 `AascNodeConnector` 主动连接主服务器 `/server`，不新增第二套注册协议。
- APK 私有目录保存配置、媒体、证书和日志；assets 只作为不可变安装输入，不直接写入用户数据。
- 不实现权限认证、自动发现、在线 Runtime 更新；保留现有手动主服务器地址和手动代码更新边界。
- 所有新增 JavaScript 使用 `const/let`、`async/await` 和 `try-catch`；Android 侧错误必须进入通知或日志，不得静默失败。

## 文件映射

- Create: `scripts/ops/prepare-android-node-runtime.js` — 校验 Node Android Runtime、服务器运行包和证书输入，生成 Gradle assets。
- Modify: `package.json` — 增加 Runtime 准备和 APK 构建前置脚本。
- Create: `tests/android-node-runtime-package.test.js` — Runtime manifest、路径安全和服务器包边界测试。
- Create: `src/apps/server/modules/runtime/android-node-capability-policy.js` — Android 节点可选能力策略。
- Modify: `src/apps/server/boot/server-app.js` — 读取 Android 节点策略，关闭不可用服务和能力上报。
- Create: `tests/android-node-capability-policy.test.js` — 能力和可选子进程策略测试。
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeManifest.kt` — Android 侧 manifest 数据和字段校验。
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt` — assets 校验、解压、版本切换和目录保护。
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerConfig.kt` — 写入 APK 私有目录中的 subserver 配置。
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt` — 前台 Service、Node launcher 进程和退出恢复。
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt` — manifest 规范化测试。
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerConfigTest.kt` — 节点配置写入测试。
- Create: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerServiceTest.kt` — 进程命令、退避和停止状态测试。
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt` — 启动 Service 并继续加载主服务器 display 页面。
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml` — 前台 Service 和 Android 13 通知权限声明。
- Modify: `src/apps/android-display/app/src/main/res/values/strings.xml` — Service 通知和失败提示。
- Modify: `src/apps/android-display/app/build.gradle.kts` — 生成 assets 目录接入和 arm64 Runtime 约束。
- Modify: `docs/design/android-embedded-node-server.md`、`docs/spec/android-embedded-node-server.md`、`docs/todo.md`、`changelog.md` — 完成后同步当前实现。

### Task 1: 建立 Android Node Runtime 和服务器包构建契约

**Files:**
- Create: `scripts/ops/prepare-android-node-runtime.js`
- Modify: `package.json`
- Modify: `src/apps/android-display/app/build.gradle.kts`
- Test: `tests/android-node-runtime-package.test.js`

**Interfaces:**
- Consumes: `AASC_ANDROID_NODE_RUNTIME_DIR`，目录内包含可执行文件 `node`；`AASC_ANDROID_NODE_PACKAGE_DIR`，目录内包含 `src/`、`package.json`、`package-lock.json` 和生产依赖；可选 `AASC_ANDROID_NODE_CERT_DIR`，包含 `cert.pem`、`key.pem`。
- Produces: `prepareAndroidNodeRuntime({ runtimeDir, packageDir, certDir, outputDir })`，在 `outputDir` 生成 `runtime/arm64-v8a/node`、`server/`、`res/certs/` 和 `runtime-manifest.json`；Gradle 从 `app/build/generated/node-runtime/assets` 打包这些 assets。

- [ ] **Step 1: Write the failing test**

  在 `tests/android-node-runtime-package.test.js` 中创建临时输入目录，覆盖以下契约：缺少 `node` 抛出明确错误；包含 `../escape` 的清单条目被拒绝；正常输入生成 manifest，且 manifest 只列出 `node`、服务器代码包和证书白名单。

  ```javascript
  test('Runtime 输入缺少 node 时拒绝生成 assets', async () => {
      await assert.rejects(
          () => prepareAndroidNodeRuntime({
              runtimeDir: path.join(tempDir, 'runtime'),
              packageDir: createServerPackage(tempDir),
              outputDir: path.join(tempDir, 'out')
          }),
          /node.*不存在/u
      );
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/android-node-runtime-package.test.js`

  Expected: FAIL because `prepareAndroidNodeRuntime` has not been exported.

- [ ] **Step 3: Write minimal implementation**

  实现固定输入/输出目录、文件白名单、相对路径安全检查、SHA-256 清单生成和原子输出目录切换。脚本不得调用 Android 运行时外部服务；构建阶段只使用 Node 文件 API。增加 npm script：

  ```json
  "prepare:android-node": "node scripts/ops/prepare-android-node-runtime.js",
  "build:apk": "npm run prepare:android-node && cd src/apps/android-display && ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk} ./gradlew :app:assembleDebug"
  ```

  Gradle `sourceSets.main.assets.srcDir(layout.buildDirectory.dir("generated/node-runtime/assets"))` 接入生成目录，并在没有 Runtime 输入时让 `npm run build:apk` 直接失败且说明所需环境变量。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/android-node-runtime-package.test.js`

  Expected: all Runtime manifest、白名单和路径安全测试 PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add package.json scripts/ops/prepare-android-node-runtime.js tests/android-node-runtime-package.test.js src/apps/android-display/app/build.gradle.kts
  git commit -m "feat: 增加 Android Node Runtime 打包契约"
  ```

### Task 2: 增加 Android 节点可选能力策略

**Files:**
- Create: `src/apps/server/modules/runtime/android-node-capability-policy.js`
- Modify: `src/apps/server/boot/server-app.js`
- Test: `tests/android-node-capability-policy.test.js`

**Interfaces:**
- Consumes: `process.env.AASC_ANDROID_NODE === '1'` 和 `config`。
- Produces: `getAndroidNodePolicy(environment)`，返回 `{ enabled, capabilities, disabledFeatures }`；`server-app.js` 使用该结果跳过 Android 节点的 ASR 服务初始化、外部 TTS 服务初始化、Puppeteer/NodeJs 任务执行入口和可选外部 Agent 子进程，并将实际能力传给 `AascNodeConnector`。

- [ ] **Step 1: Write the failing test**

  测试普通主服务器保留现有能力，Android 节点移除 `asr`、`tts`、`puppeteer`、`externalCli`、`taskRuntime`，但保留 `mediaLibrary`、`displayGateway`、`hotUpdate`；测试禁用能力错误包含 `Android APK 节点不支持`。

- [ ] **Step 2: Run test to verify it fails**

  Run: `node --test tests/android-node-capability-policy.test.js`

  Expected: FAIL because policy module does not exist。

- [ ] **Step 3: Write minimal implementation**

  新策略采用白名单而不是多段 if/else：

  ```javascript
  const ANDROID_NODE_CAPABILITIES = Object.freeze({
      mediaLibrary: true,
      displayGateway: true,
      hotUpdate: true
  });
  ```

  `server-app.js` 在 `AASC_ANDROID_NODE=1` 时不调用 `tts.init`、`asr.init` 和 Puppeteer/外部任务 runner；所有请求入口通过策略返回结构化错误。launcher 的基础 `fork(server-app.js)` 和已确认的 Bootstrap 更新流程不在此策略中禁用。

- [ ] **Step 4: Run test to verify it passes**

  Run: `node --test tests/android-node-capability-policy.test.js tests/server-api-contract.test.js tests/aasc-node-connector.test.js`

  Expected: Android policy and existing main/subserver contract tests PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/apps/server/modules/runtime/android-node-capability-policy.js src/apps/server/boot/server-app.js tests/android-node-capability-policy.test.js
  git commit -m "feat: 增加 Android 子服务器能力裁剪"
  ```

### Task 3: 实现 Android Runtime manifest 和安全安装器

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeManifest.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt`

**Interfaces:**
- Consumes: Android `AssetManager` 中的 `runtime-manifest.json` 和 `filesDir`。
- Produces: `NodeRuntimeInstaller.ensureInstalled(): File`，返回 active AASC 根目录；`NodeRuntimeManifest.parse(json): NodeRuntimeManifest`，校验 `version`、`abi`、`files`、`sha256` 和入口文件。

- [ ] **Step 1: Write the failing test**

  为 `NodeRuntimeManifest.parse` 添加测试：正常 manifest 返回 `arm64-v8a`；缺少版本、ABI 不匹配、绝对路径和 `../` 路径均抛出 `IllegalArgumentException`；文件 SHA-256 不匹配时安装器拒绝切换 active 目录。

- [ ] **Step 2: Run test to verify it fails**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeRuntimeManifestTest`

  Expected: FAIL because the classes are not present。

- [ ] **Step 3: Write minimal implementation**

  用 `org.json` 解析 manifest，使用 `MessageDigest` 流式计算 SHA-256；将 assets 解压到 `filesDir/aasc-server/staging-<version>`，验证后通过临时 active 目录重命名切换。解压函数只允许 manifest 中的相对路径，禁止符号链接逃逸和目标目录外写入；安装器不删除现有用户 `config`、`res/uploads`、`res/certs`、`logs`。

- [ ] **Step 4: Run test to verify it passes**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeRuntimeManifestTest`

  Expected: manifest parsing and install safety tests PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeManifest.kt src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt
  git commit -m "feat: 增加 APK Node Runtime 安装器"
  ```

### Task 4: 写入 APK 子服务器配置

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerConfig.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerConfigTest.kt`

**Interfaces:**
- Consumes: `mainServerUrl`、节点名、稳定节点 ID 和 active AASC 根目录。
- Produces: `NodeServerConfig.write(rootDir, mainServerUrl, nodeName, nodeId): File`，生成 `config/config.json`，返回配置文件；`NodeServerConfig.readOrCreateNodeId(rootDir)` 在重启后复用同一 ID。

- [ ] **Step 1: Write the failing test**

  测试生成配置包含 `aasc.role=subserver`、主服务器地址、节点 ID、`server.port=8081`，并将 `asr.serverEnabled=false`、`tts.serverEnabled=false`、`asr.isolateProcess.enabled=false`；测试第二次写入保留第一次节点 ID。

- [ ] **Step 2: Run test to verify it fails**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeServerConfigTest`

  Expected: FAIL because `NodeServerConfig` has not been implemented。

- [ ] **Step 3: Write minimal implementation**

  使用 Android `filesDir` 下的 active 根目录和 `JSONObject`，写入临时文件后原子替换配置。主服务器 URL 统一去掉末尾 `/`，只接受 `http`/`https`；节点 ID 首次用稳定随机值生成并保存，不能使用每次启动变化的内存值。配置写入不触碰媒体库和证书目录。

- [ ] **Step 4: Run test to verify it passes**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeServerConfigTest`

  Expected: configuration persistence tests PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerConfig.kt src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerConfigTest.kt
  git commit -m "feat: 增加 APK 子服务器配置"
  ```

### Task 5: 实现 Android 前台 NodeServerService

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/NodeServerServiceTest.kt`
- Modify: `src/apps/android-display/app/src/main/res/values/strings.xml`
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: Service Intent extra `main_server_url` 和 `NodeRuntimeInstaller` 返回的 active 根目录。
- Produces: 前台服务通知、独立 launcher `Process`、`startService`/`stopService` 生命周期；Node 命令为 `runtime/node`, `src/apps/server/boot/server-launcher.js`, `--no-tui`，环境包括 `HOME`、`AASC_ANDROID_NODE=1`、`AASC_SERVER_VERSION` 和 `AASC_SERVER_CHILD` 所需工作目录。

- [ ] **Step 1: Write the failing test**

  对可独立测试的 `NodeProcessCommand`/退避策略增加 Kotlin 单元测试：命令路径来自 active 根目录，不允许指向 assets；参数包含 `--no-tui`；首次失败延迟 1 秒，最大延迟 30 秒；用户停止后不再重启。

- [ ] **Step 2: Run test to verify it fails**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeServerServiceTest`

  Expected: FAIL because the process command and Service do not exist。

- [ ] **Step 3: Write minimal implementation**

  Service 使用 `startForeground` 和低重要性通知；启动前安装 Runtime、写配置、创建 `res/uploads`、`res/certs`、`logs`。用 `ProcessBuilder` 启动 Node launcher，读取 stdout/stderr 到 Logcat；launcher 退出时按退避重启，超过 5 次停止并更新通知。停止时先 `destroy()` launcher，超时后 `destroyForcibly()`，不使用额外 shell 命令杀进程。

  Android 13+ 声明并请求 `POST_NOTIFICATIONS`；API 26+ 创建 notification channel。服务必须明确记录 Runtime 安装、Node PID、退出码和重启次数。

- [ ] **Step 4: Run test to verify it passes**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.NodeServerServiceTest`

  Expected: command, backoff and stop-state tests PASS；编译通过。

- [ ] **Step 5: Commit**

  ```bash
  git add src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt src/apps/android-display/app/src/main/res/values/strings.xml src/apps/android-display/app/src/main/AndroidManifest.xml
  git commit -m "feat: 增加 APK Node 服务前台进程"
  ```

### Task 6: 接入 MainActivity，保持显示端连接主服务器

**Files:**
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- Modify: `src/apps/android-display/app/src/main/AndroidManifest.xml`
- Test: `src/apps/android-display/app/src/test/java/com/aasc/display/ServerConfigTest.kt`

**Interfaces:**
- Consumes: 现有 `ServerConfig.chooseUrl`、`ServerConfig.pageUrl` 和用户输入的主服务器 URL。
- Produces: Activity 启动 Service 后继续 `webView.loadUrl(mainServerUrl + "/display")`；新增测试可证明页面 URL 不包含 `127.0.0.1`、`localhost` 或 `advertisedUrl`。

- [ ] **Step 1: Write the failing test**

  给 `ServerConfig` 增加 `nodeServiceUrl`/`displayPageUrl` 契约测试：相同的主服务器输入同时作为 Service 的 `main_server_url` 和 WebView `/display` 地址，地址尾斜杠、查询参数和 `/display` 后缀处理一致。

- [ ] **Step 2: Run test to verify it fails**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.ServerConfigTest`

  Expected: FAIL because the new Service intent builder has not been接入。

- [ ] **Step 3: Write minimal implementation**

  `connect()` 在配置有效后调用 `ContextCompat.startForegroundService(Intent(this, NodeServerService::class.java).putExtra("main_server_url", input))`，然后按现有逻辑加载主服务器 `/display`。`onDestroy` 停止由本 Activity 启动的 Service；配置地址变化时先发送新地址并让 Service 重启 Node 配置，再重载主服务器页面。保留部署脚本传入地址和手动输入能力。

- [ ] **Step 4: Run test to verify it passes**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest --tests com.aasc.display.ServerConfigTest`

  Expected: 主服务器 display URL 契约测试 PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt src/apps/android-display/app/src/main/AndroidManifest.xml src/apps/android-display/app/src/test/java/com/aasc/display/ServerConfigTest.kt
  git commit -m "feat: 让 APK 启动本地子服务器并连接主显示端"
  ```

### Task 7: 构建、集成验证和文档收口

**Files:**
- Modify: `docs/design/android-embedded-node-server.md`
- Modify: `docs/spec/android-embedded-node-server.md`
- Modify: `docs/task/20260908_APK内置Node.js子服务器.md`
- Modify: `docs/todo.md`
- Modify: `changelog.md`
- Test: `tests/android-node-runtime-package.test.js`, `tests/android-node-capability-policy.test.js` 和 Android 单元测试

**Interfaces:**
- Consumes: Tasks 1–6 的 Runtime、Service、AASC 能力策略和显示端 URL 契约。
- Produces: 可重复的 `npm run prepare:android-node`、`npm run build:apk` 验证结果和真机验收记录。

- [ ] **Step 1: Run JavaScript verification**

  Run: `node --test tests/android-node-runtime-package.test.js tests/android-node-capability-policy.test.js tests/server-launcher.test.js tests/aasc-node-connector.test.js tests/server-api-contract.test.js`

  Expected: 新增 Runtime/能力测试和既有 launcher/AASC 契约测试全部 PASS。

- [ ] **Step 2: Run Android unit tests**

  Run: `cd src/apps/android-display && ./gradlew testDebugUnitTest`

  Expected: 现有 Android 单元测试和新增 manifest/config/service 测试全部 PASS。

- [ ] **Step 3: Build the APK**

  Run: `AASC_ANDROID_NODE_RUNTIME_DIR="$PWD/.local/android-node-runtime/arm64-v8a" AASC_ANDROID_NODE_PACKAGE_DIR="$PWD/.local/android-node-package" npm run build:apk`

  Expected: 生成 arm64 debug APK；构建日志显示 Runtime manifest 已打包，未把 `logs/`、用户媒体或模型写入 assets。

- [ ] **Step 4: Verify on Android 9 arm64**

  安装 APK 后检查：前台通知出现；Logcat 显示 launcher PID 和 server-app 启动；主服务器节点列表出现 APK 子服务器；WebView 当前 URL 是 `https://192.168.1.39:8081/display`；主服务器控制端能读取 APK 媒体库；停止/启动 Service 不产生额外 Node 进程；ASR/Wine/Puppeteer/外部 CLI 没有启动日志。

- [ ] **Step 5: Update docs and remove completed todo**

  将实际构建命令、Runtime 版本、真机结果、不可用能力和异常处理写回设计/spec/task；从 `docs/todo.md` 删除已完成的进行中条目；在 `changelog.md` 记录改动文件和验证结果。

- [ ] **Step 6: Run final verification**

  Run: `npm test && git diff --check && git status --short`

  Expected: 记录全量测试结果；若存在与本次无关的既有失败，明确列出测试名和原因，不修改无关代码；工作区只保留用户原有未相关改动和本次待提交文件。

- [ ] **Step 7: Commit**

  ```bash
  git add docs/design/android-embedded-node-server.md docs/spec/android-embedded-node-server.md 'docs/task/20260908_APK内置Node.js子服务器.md' docs/todo.md changelog.md tests src/apps scripts package.json
  git commit -m "feat: 将 Node.js 子服务器整合进 APK"
  ```

## Runtime 依据

构建 Node.js Android Runtime 时按固定版本和 arm64 ABI 生成输入目录。上游 Node.js 文档明确 Android 构建属于非支持平台，Node.js Mobile 项目提供 Android 构建和发行物；因此 Runtime 二进制必须作为独立、可校验的构建输入，不伪装成普通桌面 Node.js 下载包。参考：[Node.js BUILDING.md Android](https://github.com/nodejs/node/blob/main/BUILDING.md#android)、[nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)。
