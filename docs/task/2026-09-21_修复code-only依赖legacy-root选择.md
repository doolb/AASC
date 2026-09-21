# 修复 code-only 依赖错误选择 legacy-root

## 任务描述

修复 Offline APK 在已有 `updates/dependencies/dependencies-v4` 热更依赖时，执行 code-only 服务代码更新仍沿用 APK 根目录 `node_modules`（`legacy-root`）的问题。代码 v19 应与清单要求的 dependencies v4 配对启动。

## design 需求

- code-only 应用服务代码时，优先查找清单指定版本的热更依赖目录。
- 热更依赖目录必须包含 `node_modules` 和 `.offline-update-verified.json`，且 marker 的 kind、version、SHA-256 均匹配。
- 校验通过后写入 `legacyDependencies=false`；只有热更目录不可用时，才保留旧版 `legacy-root` 兼容回退。
- 本次属于 Android 原生更新逻辑变更，只重打和发布 min APK，不打完整 Offline APK。

## spec 设计

```text
resolveCodeOnlyDependency(root, dependencyVersion, dependencySha256, previousDependencyVersion, previousLegacy):
    candidate = root/updates/dependencies/dependencies-v<dependencyVersion>
    如果 candidate/node_modules 和 marker 完整且 marker 匹配：
        返回 candidate/node_modules, legacyDependencies=false
    如果 previousLegacy 为 true 或缺失：
        返回 root/node_modules, legacyDependencies=true
    返回旧的 versioned dependency node_modules, legacyDependencies=false

apply code-only:
    安装 code 目录
    解析依赖目录并要求目录存在
    写入 active-release.json，使用解析出的 legacyDependencies
```

## 受影响的功能模块和代码

- `src/apps/android-display/app/src/main/java/com/aasc/display/OfflineUpdateManager.kt`
  - 新增 code-only 依赖目录解析和 marker 校验。
  - code-only release 指针使用实际解析出的依赖来源。
- `src/apps/android-display/app/src/test/java/com/aasc/display/OfflineUpdateManagerTest.kt`
  - 覆盖热更依赖优先和校验失败回退。
- `release/apkbuild/allserver-min/app.json`
  - min APK 版本升至 v31 / `0.2.29-offline-min`。
- `tests/apk-build-profile.test.js`
  - 同步 min profile 版本断言。
- `docs/design/android-offline-hot-update.md`
- `docs/spec/android-offline-hot-update.md`
- `docs/todo.md`
- `changelog.md`

## 自测用例

- JVM：已校验 dependencies v4 时，即使旧指针为 `legacyDependencies=true`，解析结果也必须为 `updates/dependencies/dependencies-v4/node_modules`。
- JVM：marker SHA 不匹配时，必须回退 `root/node_modules` 并保持 `legacyDependencies=true`。
- Android：运行 `:app:testDebugUnitTest`。
- Node：运行 Offline min profile、发布清单和发布器相关测试。
- 发布：验证 LAN/WAN 清单、签名、HTTP、文件大小、SHA-256 和精确旧版本清理。

## 兼容性测试

- 兼容没有 active-release 指针的旧 Offline APK。
- 兼容旧指针仍标记 `legacyDependencies=true` 的安装状态。
- 不改变 all 更新安装依赖目录的行为。

## 性能测试

- 依赖目录选择只读取一个 marker 文件和目录属性，不扫描 `node_modules` 内容。
- min APK 使用现有 MNN 构建缓存，不重新引入模型。

## 风险评估

- marker 缺失或损坏时会回退 legacy-root，避免服务直接丢失依赖，但需要后续通过 all 更新修复。
- min APK 仅更新原生逻辑，必须与完整 Offline APK 的签名一致；不发布完整 APK。

## 预计工时

- 代码、单测、构建和发布约 30 分钟。

## 执行结果

已完成：

- `OfflineUpdateManager` 已按清单动态选择目标依赖版本，修复旧指针导致的 `legacy-root` 误选。
- Offline Node 启动前会迁移已有旧 active release：目标版本依赖 marker 有效时，或旧流程目录通过依赖包 version、lockSha256 和 express 元数据校验时，原子将 `legacyDependencies` 改为 `false`，无需再次下载 code/dependencies。
- Android `testDebugUnitTest` 25/25 通过。
- min APK v31（`0.2.29-offline-min`）已构建并发布到 LAN/WAN；大小 `89272786` bytes，SHA-256 为 `57539cf8fbf296c5da687cd959deae60bd64bdb5ab0832b25d5d8ab5bfa3cbed`；版本清单中的依赖版本按当前目标动态选择。
- LAN/WAN 清单均为 code v19、dependencies v4、apkMin v31；APK v2 签名、HTTP Content-Length、清单字节一致和旧 min 精确清理通过。
- Node 定向回归 58 项通过 57 项；唯一失败为既有固定 `displayId` 测试数据不一致，未涉及本任务。
- 未构建或发布完整 Offline APK。
- ADB 真机 `192.168.1.6:5555` 已覆盖安装 min v31 并启动 display 2；设备原 active release 为 code v15、dependencies v4，服务更新检查正确发现 code v19。由于外接 display 2 无触摸输入，使用已发布且 hash 一致的 code v19 做等价 code-only 安装后重启验证。
- 真机 `/api/status` 返回 `apk=apk-0.2.29-offline-min`、`code=v19`、`dependencies=v4`、`dependencySource=active-release`，`codePath` 为 `updates/code/code-v19`，`dependenciesPath` 为 `updates/dependencies/dependencies-v4/node_modules`；Node 进程环境中的 `AASC_NODE_MODULES_DIR` 同路径，未再使用 `legacy-root`。
- 内屏 display 0 实际打开控制端“服务器”页面复核，页面显示依赖来源 `active-release`、服务代码 v19、依赖 v4 及上述 versioned 路径；控制端页面未显示 `legacy-root`。
