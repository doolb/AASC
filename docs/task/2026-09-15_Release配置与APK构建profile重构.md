# Release 配置与 APK 构建 profile 重构

## 任务描述

让服务器可以通过 `npm start -- --release` 直接使用 `release/` 下的配置、用户配置和任务结果，并将三个 APK 构建命令固定到已有的 `noserver`、`withserver`、`allserver` profile。每个 profile 使用独立的中间目录，依据 `app.json` 选择运行能力和模型；APK 首次安装后恢复任务结果索引中标记为运行中的服务实例。

## Design 需求

- 服务器无 `--release` 时保持现有 `config/`、用户目录和 `res/tasks/` 路径。
- 服务器有 `--release` 时读写 `release/config/`、`release/userconfig/` 和 `release/task/`，输入缺失时明确失败。
- `build:apk` 使用 `withserver`，`build:apk:offline` 使用 `allserver`，新增 `build:apk:noserver` 使用 `noserver`。
- `app.json` 只声明 schema、Node 内置开关、功能和模型，不声明任务列表。
- `noserver` 的模型列表必须为空；`features` 进入 profile 元数据，原生依赖仍完整保留。
- 任务定义与 `results/index.json`、实例目录、日志、输出一并打包；只恢复 `mode=service && status=running` 的实例。
- `noserver` 不打包、不启动 Node Runtime，保留显示端连接主服务器的能力。

对应设计文档：`docs/design/release-build-profiles.md`。

## Spec 设计

```text
resolveReleaseRuntimeContext(argv, environment):
    如果存在完整参数 --release 或 AASC_RELEASE_MODE == "1":
        返回 releaseMode=true 和 release/config、release/userconfig、release/task
    否则返回当前开发路径

loadApkProfile(profile):
    读取 release/apkbuild/<profile>/app.json
    校验 schemaVersion、embeddedNode、features、models
    不读取 tasks 字段

prepareApk(profile):
    创建独立 package/runtime/gradle/output 路径
    按 model ID 收集模型，保留 release/task 下的 results
    将软链接转换为 marker
    embeddedNode=false 时跳过 Node Runtime

installRuntime():
    不覆盖已有用户配置和任务结果
    首次安装恢复 latest/task-links marker
    server-app 继续由 restoreAutoStartServices 恢复 running service 实例
```

对应实现规范：`docs/spec/release-build-profiles.md`。

## 受影响的功能模块和代码

- 服务器运行路径：`src/core/release-runtime-context.js`、配置服务、TaskIO、server launcher。
- APK 编排和资源打包：`scripts/ops/apk-build-profile.js`、`scripts/ops/build-apk.js`、`scripts/ops/prepare-android-server-package.js`、Runtime 准备器。
- Android 构建和安装：Gradle profile、`MainActivity.kt`、`NodeRuntimeInstaller.kt`。
- 构建入口：`package.json`、三个 `release/apkbuild/*/app.json`。

## 自测用例

- Node release 路径和 launcher 环境变量单元测试。
- profile 校验、模型 ID 解析、results 索引和 marker 资产测试。
- 三个 npm 脚本和独立中间目录测试。
- Android Gradle、noserver 不启动 Node、Runtime marker 恢复静态/JVM 测试。
- 全量 `npm test`、Android `:app:testDebugUnitTest`、`git diff --check`。

## 兼容性测试

- 保持 `npm start` 原有路径和显式 `TaskIO({ tasksDir })` 调用。
- 普通 APK、Offline APK 和 noserver APK profile 分别构建。
- Android 现有用户数据升级时不覆盖已有配置、任务结果和模型文件。
- APK 首次启动恢复 running service，stopped/completed/failed 只保留结果记录。

## 性能测试

- 比较模型按 profile 选择前后的 APK 体积和 Runtime 资产清单。
- 检查 profile 间 Gradle 中间目录不会重复写入。
- 记录首次安装解包和服务器启动耗时；本任务不处理 `.mmap` 预生成。

## 风险评估

- release 输入为空或 results 索引损坏时构建失败，需要用户先准备发布输入。
- Android assets 不支持软链接，marker 恢复失败会影响 latest 选择但不应破坏实例目录。
- 原生 AAR 依赖继续保留，功能裁剪仅作用于运行包和资源，避免 native 库缺失导致启动崩溃。
- 当前阶段不自动提交 git，构建产物和用户已有改动需单独检查。

## 预计工时

约 4—6 小时，包含 Node/Android 定向测试和一次构建验证。

## 执行结果

- 已完成服务器 release 上下文、三个 APK profile、独立中间目录、模型 ID 选择、任务 results/marker 打包与首次安装恢复逻辑。
- 已完成 Android `embeddedNode` 构建开关；noserver 不携带或启动 Node Runtime，withserver/allserver 使用 release 种子。
- Node 定向测试：本任务相关测试 54/54 通过；全量测试存在一个既有的 Windows 输入模式声纹策略断言失败，与本任务无关。
- Android JVM/Gradle 验证未能在当前环境完成：缺少固定环境变量 `AASC_MNN_ROOT` 对应的官方 MNN checkout，Gradle 在 native 配置阶段停止；实际 APK 未宣称构建成功。
- 未处理 `.mmap` 预生成；未执行真机安装和现场验收。

## 2026-09-15 补充执行结果

- release 构建输入补齐：`release/config/config.json` 使用当前 `config/config.json` 的配置种子；`release/task` 同步当前任务定义、results/index 和实例结果。
- 修复 Runtime 打包器对跨平台任务结果的兼容：`results/latest` 同时支持软链接和文本实例 ID；原始 `latest` 不进入 APK，统一生成 `latest.marker`。`release/task/llm.chat/results/latest` 指向不存在的 `qwen3.5` 实例，因此仅从 release 副本移除该失效 marker，原始 `res/tasks` 保持不变。
- 使用 `npm run build:apk:offline` 重新构建成功，profile 为 `allserver`，offline 和 embedded Node 均为 `true`；APK 内含 release 配置、6 个有效任务 latest marker、task-links marker、默认 MNNChat 模型及 VAD 修复后的控制端脚本。
- 产物：`release/apkbuild/allserver/output/aasc-display-offline.apk`，大小 957217619 bytes，SHA-256 为 `1528d5d7a32e5c247448f1fbda9d15c70be414331590259a70533f66be148dd4`。
- 验证：ZIP 完整性通过（33734 个文件）；Runtime/profile/Release 集成回归 27/27 通过；JavaScript 语法检查和 `git diff --check` 通过。本次未执行真机安装。

## 2026-09-15 `.gitkeep` 模型占位文件修复与重打包

- 根因：目录型模型的兜底扫描会把 `.gitkeep` 当作模型文件加入离线 manifest；Android AssetManager 对隐藏文件的处理不稳定，导致 manifest 与实际 APK 资产不一致。
- 变更：`scripts/ops/apk-build-profile.js` 的目录型模型扫描跳过 `.gitkeep`，但保留需要映射为可打包名称的 `.manifest.json`；新增 `tests/apk-build-profile.test.js` 回归用例。
- TDD 验证：新增用例先以实际返回 `sensevoice/.gitkeep` 失败，修复后 `tests/apk-build-profile.test.js` 6/6 通过。
- 使用 `npm run build:apk:offline` 重打包成功；APK 大小 957217710 bytes，SHA-256 为 `2f8634fb596782bed672a7fd7a19a648d718d07f0996d87fbe04a2440f70005a`。
- 最终包检查：ZIP 完整性通过（33734 个文件）；APK 资产和离线模型 manifest 均不含 `.gitkeep`，离线模型文件 38 个；相关 Runtime/profile/Release 回归 28/28 通过。
- 启动耗时：当前 `NodeServerService` 已记录 Runtime 解包耗时和 Node 总启动耗时；分阶段统一报告（APK 进程、WebView、8081、任务恢复、模型首载）列为后续可选优化，未在本次改动中实现。

## 2026-09-16 首次安装恢复与 Runtime 校验开关

### 任务描述

修复真实卸载重装时 offline APK 因 `results/latest` 指向空实例目录而无法启动的问题，并允许通过 profile 的 `app.json` 决定是否执行 Runtime 全量 SHA-256 校验。

### Design 需求

- latest marker 指向的实例目录不存在时，若实例 ID 合法，应创建空目录后恢复 `results/latest`；目标路径为普通文件时仍然失败。
- `verifyRuntime` 缺省为 `true`；开启时校验 Runtime 文件存在性、大小和 SHA-256，关闭时只校验普通文件存在性。
- 配置应从 `app.json` 传入构建 manifest，并由 Android 安装器执行；不改变用户配置、模型和任务结果的保留规则。

对应设计文档：`docs/design/release-build-profiles.md`、`docs/design/android-embedded-node-server.md`。

### Spec 设计

```text
loadApkProfile(profile):
    读取 app.json.verifyRuntime
    缺省时返回 true
    非布尔值时构建失败

prepareAndroidNodeRuntime:
    将 verifyRuntime 写入 runtime-manifest.json

NodeRuntimeInstaller.ensureInstalled:
    verifyRuntime=true  -> 校验每个文件的大小和 SHA-256
    verifyRuntime=false -> 仅校验每个文件存在且为普通文件
    latest marker 目标实例目录不存在 -> 创建空目录后恢复软链接
```

对应实现规范：`docs/spec/release-build-profiles.md`、`docs/spec/android-embedded-node-server.md`。

### 受影响的功能模块和代码

- Profile 与运行包：`scripts/ops/apk-build-profile.js`、`scripts/ops/build-apk.js`、`scripts/ops/prepare-android-node-runtime.js`。
- Android 安装器：`NodeRuntimeManifest.kt`、`NodeRuntimeInstaller.kt` 及 JVM 测试。
- Release 配置：`release/apkbuild/{allserver,withserver,noserver}/app.json`。
- 文档：对应 design/spec、`docs/todo.md` 和 `changelog.md`。

### 自测与兼容性测试

- Node profile/runtime 和 APK 编排相关回归：47/47 通过。
- Android `:app:testDebugUnitTest`：`BUILD SUCCESSFUL`；包含空实例目录创建和 manifest 默认值/关闭值测试。
- 真实设备 `SM-N9500`（Android 9/API 28，Display 2）已安装当前默认不校验版本；Runtime 内容更新后完成安装，恢复 `llm-server 40f3b6b1`，显示端成功连接。
- Runtime 日志确认 `verifyRuntime=false` 已生效：跳过完整 SHA-256 内容校验；本次内容安装耗时约 116.9 秒（该耗时包含 Runtime 文件复制，不等同于仅复用已安装 Runtime 的启动耗时）。
- 通过 ADB forward 以 HTTPS 访问本机 8081：`/api/status` HTTP 200、`/v1/models` HTTP 200；使用默认 MNN 模型发送 chat completion 返回 HTTP 200。
- 当前 APK 完整性检查通过，未包含 `.gitkeep`；manifest 记录 `verifyRuntime=false`，文件数 33261。产物大小 958958783 bytes，SHA-256 为 `1053ded34e19fb6998c2cd743ca69484374c1dbd757dd284605bf600d0cecd8e`。

### 风险与未处理项

- profile 解析缺省仍为 `verifyRuntime=true`，但正式 offline `allserver/app.json` 默认配置为 `false`，`withserver`/`noserver` 仍为 `true`；开关只影响首次 Runtime 内容校验耗时，不减少 APK 体积。
- 本任务不预生成 `.mmap`，也不改变聊天输出中的 think 过滤逻辑。
