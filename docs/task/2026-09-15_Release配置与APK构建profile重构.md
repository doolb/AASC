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
