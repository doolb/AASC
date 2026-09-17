# Android Offline APK 服务热更新与原生增量 APK 实现计划

> **For agentic workers:** 实施前先通过设计/spec 文档复核；按照下列任务逐项测试。未经用户另行要求不提交 Git。

**Goal:** 为 Offline APK 增加可单独发布代码的服务热更新、代码+依赖整体更新和只更新 Android 原生代码/库的 `allserver-min` APK 通道。

**Architecture:** 服务更新清单分别版本化 code、dependencies、apk-min，并由 APK 内置公钥验证 RSA-SHA256 签名。Node 启动前将更新解压到版本目录，以单一 active-release 标记切换代码/依赖配对，保留旧 release 回退。min APK 以相同包名/签名和更高版本码原位更新，只应用受限 Node 原生运行库，不替换 app 私有数据；LLM asset 在系统安装 APK 前先物化并校验。

**Tech Stack:** Node.js/npm scripts、Android Kotlin、Gradle、Node `node_modules` 生产包、RSA-SHA256 签名、HTTP(SCP) 发布、Android PackageInstaller。

**Spec:** `docs/design/android-offline-hot-update.md`、`docs/spec/android-offline-hot-update.md`

## 全局约束

- 服务只提供 `code-only` 与 `all` 两种模式；不提供 dependency-only 模式。
- `code-only` 不构建、发布或下载 `node_modules`，且必须匹配已发布依赖 lockfile 指纹。
- 更新失败、无网络或空间不足时保留旧 release；配置、任务/results、日志、上传、ASR/TTS 模型和 LLM 缓存不能被更新器删除或覆盖。
- 清单 RSA-SHA256 签名私钥不得进入仓库、APK、日志或 HTTP 目录；APK 内只放验证公钥。
- min APK 包名必须是 `com.aasc.display.offline`，签名必须与 full APK 相同，versionCode 必须递增；全量包 v2、min 包 v3 是首轮目标。
- 不生成或删除 `.mmap`，不加入模型下载热更新，不卸载 APK，不覆盖发布目录中无关文件或现有 APK 链接。
- 构建优先通过 `npm run`；工作区 dirty 内容全属用户，禁止 reset/clean/revert。

## 受影响文件

- `package.json`：加入服务更新构建/发布、offline min 构建/发布脚本。
- `scripts/ops/offline-update-package.js`、`scripts/ops/publish-offline-update.js`（新）：服务档案、签名清单和保留已有依赖的发布流程。
- `scripts/ops/apk-build-profile.js`、`scripts/ops/build-apk.js`、`scripts/ops/prepare-android-node-runtime.js`：支持 `allserver-min` update-only profile 和只准备最小原生运行库。
- `release/apkbuild/allserver-min/app.json`（新）、`release/apkbuild/allserver/app.json`、Android `app/build.gradle.kts`：更新 profile 元数据和 APK 版本码。
- Android 新增 `OfflineUpdateManifest.kt`、`OfflineUpdateManager.kt`；修改 `MainActivity.kt`、`NodeServerService.kt`、`NodeRuntimeInstaller.kt`、`NativeBridge.kt`、`MnnLlmModelManager.kt`、`AndroidManifest.xml`。
- 新增 Node 与 Android JVM 回归测试；同步 `docs/design.md`、`docs/spec.md`、`docs/todo.md`、`changelog.md`。
- 新增 `release/offline-update/` 仅作为可公开的 channel 元数据/公钥配置入口；私钥仅从受保护环境文件读取。

## 执行任务

### Task 1：定义服务包和签名清单

**Files:** 新建 `scripts/ops/offline-update-package.js`；新建 `tests/offline-update-package.test.js`；修改 `package.json`。

- [x] 测试 `code-only` 档案只含完整 `src/` 与 package 元信息，不含 `node_modules`，且不调用 `npm ci`。
- [x] 测试 `all` 生成代码档案和匹配 lockfile 的 Android production dependency 档案，并剔除 npm `.bin` 软链接目录。
- [x] 测试 lockfile 与已部署 dependencies 不匹配时 `code-only` 失败，manifest 中 dependency 条目不变。
- [x] 实现 ZIP 清单、大小/SHA-256 与 canonical JSON RSA-SHA256 签名/验证；越界路径和签名不匹配明确失败。
- [x] 使用 `node --test tests/offline-update-package.test.js` 验证。

### Task 2：安全发布服务更新包

**Files:** 新建 `scripts/ops/publish-offline-update.js`；新建 `tests/offline-update-publish.test.js`；修改 `package.json`。

- [x] 用临时本地目录测试版本化档案先于签名 manifest 发布，manifest 使用临时文件+rename 最后切换。
- [x] 覆盖 `code-only` 不复制/上传 dependency 档案，`all` 发布 code 和 dependencies。
- [x] 覆盖上传失败时不触碰既有 manifest；拒绝目标目录 symlink/冲突文件，且不清理目录或 APK symlink。
- [x] 实现局域网本地目标和显式 SCP 远端目录的顺序发布；发布后通过 HTTP GET 流式复验签名 manifest 和组件 hash。
- [x] 使用 `node --test tests/offline-update-publish.test.js` 验证。

### Task 3：建立 `allserver-min` 构建 profile

**Files:** 修改 `scripts/ops/apk-build-profile.js`、`scripts/ops/build-apk.js`、`scripts/ops/prepare-android-node-runtime.js`、`src/apps/android-display/app/build.gradle.kts`；新建 `release/apkbuild/allserver-min/app.json`；扩展 `tests/apk-build-profile.test.js`、`tests/android-node-runtime-package.test.js`。

- [x] 测试 min profile 必须声明 `updateOnly=true`，没有 models，且构建计划不调用完整 `prepareAndroidServerPackage`。
- [x] 测试 min Runtime 资产只列 allowlisted Node native runtime libraries，不含 `src`、`node_modules`、模型权重、任务或配置种子。
- [x] 配置 `build:apk:offline:min`，输出 `release/apkbuild/allserver-min/output/aasc-display-offline-min.apk`。
- [x] 将 `versionCode` 从硬编码改为 profile 配置；首轮 allserver v2、allserver-min v3；offline applicationId 统一为 `com.aasc.display.offline`。
- [x] 使用 `node --test tests/apk-build-profile.test.js tests/android-node-runtime-package.test.js tests/offline-apk-build-profile.test.js` 验证。

### Task 4：Android 签名清单、下载和代码/依赖版本切换

**Files:** 新建 `OfflineUpdateManifest.kt`、`OfflineUpdateManager.kt`、对应 Kotlin 测试；修改 `NodeServerService.kt`、`NodeRuntimeInstaller.kt`。

- [x] 为 RSA-SHA256 canonical manifest 验签、版本依赖约束、安全相对 URL 和 archive 路径边界写 JVM 测试并实现校验。
- [x] 实现 LAN-first、有界超时、连接失败才 fallback WAN；两端不可达时使用旧 release；验签或完整性失败不接受该更新。
- [x] 实现分区下载、剩余空间预检、大小/hash 校验和仅普通文件的安全解压。
- [x] 实现版本化 code/dependency/release 目录及 `active-release.json` 原子切换；`code-only` 只下载代码；`all` 下载并切换代码+依赖；保留旧 release 直到候选启动成功。
- [x] 将 `updates/` 纳入 Node Runtime 可迁移用户目录并验证 active release 与旧目录兼容路径。
- [x] Node launcher 读取 active release entrypoint，工作目录仍为 `files/aasc-server`，依赖目录固定绑定该 release；无 active marker 时继续兼容旧目录。
- [x] 更新失败或候选启动失败时恢复上一 active release；失败版本不循环重试。
- [x] 运行 `cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon`。

### Task 5：min APK 安装守卫和模型/Runtime 保留

**Files:** 修改 `MainActivity.kt`、`NodeRuntimeInstaller.kt`、`MnnLlmModelManager.kt`、`OfflineUpdateManager.kt`、`AndroidManifest.xml`；新增 `OfflineApkInstallReceiver.kt` 和 Android JVM 测试。

- [x] 实现 update-only APK 的完整包数据守卫；无 full-install 数据时提示并退出，不启动 Node。
- [x] update-only Runtime 清单和安装器限制到 allowlist 动态库；完整目录替换、服务数据目录不在 min 安装路径中。
- [x] 更新管理器可预估并物化完整 APK 内置 LLM 权重；缓存先行校验，min APK 不含模型资产时继续复用完整包模型缓存。
- [x] 通过签名 manifest 中的模型兼容指纹拒绝与完整包模型不兼容的 min APK；Node/Android 指纹规范化排序一致。
- [x] 实现 min APK 下载和大小/hash/applicationId/signer/versionCode/versionName 校验；先检查磁盘空间并物化模型，再向 Android PackageInstaller 提交需要用户确认的安装会话。
- [x] 声明未知来源安装权限；用户可选择稍后或前往系统授权，安装结果 receiver 处理确认页与成功缓存清理。后台完成时延迟到 Activity 前台提交。
- [x] 安装器只替换 manifest 允许的原生库并保留 `updates/`、models、配置、任务/results、日志和 LLM cache。
- [x] 运行 Android 全量 JVM 测试：`:app:testDebugUnitTest` BUILD SUCCESSFUL。
- [ ] 构建 full/min APK 并真机验证 PackageInstaller 原位更新、失败保留旧包与服务数据；full/min 构建和静态校验已完成，此项在 Task 6 验收。

### Task 6：首轮构建、真机升级与双站点发布

**Files:** `tests/android-offline-apk.test.js`、`tests/release-build-profiles.integration.test.js`、`docs/usage/android-offline-update.md`（新）及索引/日志文档。

- [ ] 更新全量测试覆盖 APK package ID、signer digest、versionCode 和 update-only manifest。
- [ ] 运行 `npm test`、Android JVM tests、`:app:assembleDebug` full/min builds 和 ZIP/APK manifest 静态检查；当前 `npm test` 818/819，有 1 项无关语音输入断言失败，Android JVM 全量通过。
- [ ] 在已安装 v1 的真机上原位升级 full v2；检查配置、任务/results、ASR/TTS 与 LLM cache；再从 app 发起 min v3 系统确认安装。
- [x] 已按测试要求卸载真机原有 `com.aasc.display.offline` v1 包；系统校验包已不存在，应用私有数据随卸载删除，`/data` 可用空间约 3.7 GiB。后续改为 fresh install full v2，再验证 min v3。
- [x] fresh install full v2 成功；首次 Runtime 解包约 911 MiB，`/api/status`、`/v1/models`、默认模型 `qwen3.5-0.8b-claude-opus-distilled-mnn` 和 Chat Completions 均返回成功。
- [x] 修复 Android code ZIP 目录项去除尾部 `/` 后与白名单不一致的问题；规范化后的 `src`、`node_modules` 根目录可通过校验，跨组件和 Android 显示端路径仍被拒绝。
- [x] 修复后重新打包 full v2 并发布 all v3；真机 fresh install 后确认 `active-release.json` 生成，code/dependencies v3 热更启动且 `pendingHealth=false`。
- [x] 真机验证 `/api/status`、`/v1/models`、默认模型聊天、显示页连接和显示端录音启动；ASR/TTS 完整业务回归、code-only、LAN unavailable fallback、bad hash fallback、低空间不切换仍待补充。
- [x] 版本化服务包、min APK 和签名 manifest 已发布到局域网/外网；签名、包名、证书摘要和 HTTP GET 两站点 hash 复验通过。设备端回滚和 min 原位安装仍待完成。
- [x] 更新 design/spec 实施状态、`docs/todo.md` 和 `changelog.md`，记录本次目录校验修复、full APK、v3 服务包及真机结果；用户已明确要求提交 Git，本次仅提交本任务相关源码、测试和文档。

### Task 7：接入用户配置目录中的生产更新密钥并打包

**Files:** 新建 `scripts/ops/offline-update-signing.js`、`tests/offline-update-signing.test.js`；修改 `scripts/ops/offline-update-package.js`、`scripts/ops/offline-min-apk-package.js`、`scripts/ops/publish-offline-update.js`、`scripts/ops/build-apk.js`、`scripts/ops/prepare-android-node-runtime.js` 及其直接测试。

- [x] 先为默认路径解析、公私钥匹配、RSA 类型、私钥权限和符号链接拒绝编写失败测试；测试只使用临时密钥和临时目录。
- [x] 实现默认路径 `~/.config/aasc-user/offline-update-private.pem` / `offline-update-public.pem`，支持 `AASC_OFFLINE_UPDATE_PRIVATE_KEY` / `AASC_OFFLINE_UPDATE_PUBLIC_KEY` 覆盖；不打印密钥内容。
- [x] 服务更新构建、min APK 清单构建、发布清单校验共用同一密钥来源；full/min APK 只注入公钥，并在构建前检查公私钥匹配。
- [x] 运行更新包、min package、publisher、runtime package 和 APK build profile 定向 Node 测试及 Android 全量 JVM 单测。
- [x] 通过 `npm run build:apk:offline` 与 `npm run build:apk:offline:min` 构建 full v2/min v3；检查 ZIP 完整性、公钥指纹一致和 APK assets 不含私钥。
- [x] 生成 code/dependencies v1 首发包和引用 min APK v3 的签名清单；仅生成本地工件，不向 LAN/WAN 上传。
- [x] 更新 design/spec、`docs/todo.md` 和 `changelog.md` 的实测状态；真机升级、回滚和双站点发布继续保留为待验收项。

> 已修复：更新包构建器默认在 `os.tmpdir()` 生成归档，与 release 输出跨文件系统时会遇到 `EXDEV`。Task 8 已改为输出目录内暂存再原子切换；本地默认 `/tmp` 环境无需额外设置 `TMPDIR`。

### Task 8：修复服务更新包跨文件系统落盘

**Files:** 修改 `scripts/ops/offline-update-package.js`、`tests/offline-update-package.test.js`，同步 design/spec/todo/changelog。

- [x] 新增输出目录位于工作区挂载点、归档暂存位于系统临时挂载点的 `all` 模式端到端测试，确认代码包、依赖包和最终签名清单都成功生成。
- [x] 测试先因 `EXDEV: cross-device link not permitted` 失败，再实现输出目录同目录临时文件复制与原子 rename；清单也在目标目录内暂存，并保证失败时清理临时文件。
- [x] 验证正常 `/tmp` 默认环境无需设置 `TMPDIR` 即可构建，归档/签名清单内容与现有契约一致；更新文档并保留远端发布、真机验收为未完成项。定向测试 `tests/offline-update-package.test.js` 12/12 通过。

### Task 9：兼容非 POSIX SSH 登录 shell 的远端热更发布

**Files:** 修改 `scripts/ops/publish-offline-update.js`、`tests/offline-update-publish.test.js`，同步 design/spec/todo/changelog。

- [x] 增加远端发布命令契约测试，确认 POSIX 检查/原子切换脚本由远端 `/bin/sh -c` 执行；发布器测试 10/10 通过。
- [x] 修复 SSH 命令封装并验证当前 fish 登录 shell 下远端目录检查、SCP 临时文件和 manifest 原子切换；同时修复远端 manifest `0600` 导致 Apache 403 的权限问题。
- [x] 重新发布到 LAN/WAN 并执行 HTTP 清单及全部组件 hash 复验；服务 v2/min v3 两个通道均通过，真机热更结果因设备空间不足保留为未完成项。


## 自测、兼容性与性能

- Node 包生成：`node --test tests/offline-update-package.test.js tests/offline-update-publish.test.js`。
- 项目回归：`npm test`、`npm run test:log-brain` 不作为本任务必需；运行与变更直接相关的 release/APK 测试。
- Android：`cd src/apps/android-display && ./gradlew :app:testDebugUnitTest --no-daemon`，再分别构建 full offline 与 offline min。
- 兼容：API 26 起、arm64-v8a、现有 debug APK signer、旧目录无 active-release marker、旧 Runtime marker 与已有 mutable 数据。
- 性能：记录 LAN/WAN manifest 查询、代码档案下载/解压、all 依赖档案下载/解压、active marker 切换时长；代码-only 不应产生依赖包网络流量。

## 风险与预计工时

- HTTP 更新源通过签名验证缓解恶意替换；RSA 私钥丢失会使后续设备无法接受清单，密钥需备份且不可提交。
- Android APK 原位更新受同包名、同签名、versionCode 单调递增约束；签名不符只能拒绝，不能通过卸载规避。
- 首次应用完整服务依赖更新需要额外存储空间；预检失败必须继续旧代码，不能提前删除旧 release。
- MNN 权重首次推理时尚未落盘会使 min APK asset 替换后无法补齐模型，因此安装前必须物化与校验。
- Gradle 原生构建依赖本地 `AASC_MNN_ROOT` 和 NDK；缺环境时不能把静态文件测试误报为真机构建成功。
- 预计 16–24 小时实现、测试和双通道真机验收，不含等待远端设备或人工点击系统安装确认的时间。

## 待确认事项

- 用户之前输入的外网目录是 `~/a/aasc-offlin`，比按 HTTP 映射推断的 `~/a/aasc-offline/` 少了末尾 `e`；远端 inferred 目录只读检查存在，但正式 SCP 上传前确认目标目录。
- 生产 RSA 私钥路径/保管方式尚未指定。自动测试使用临时密钥；生成或使用生产密钥、签名并发布前必须确认密钥位置和备份责任。
