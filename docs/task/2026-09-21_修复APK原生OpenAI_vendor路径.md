# 修复 APK 原生 OpenAI `_vendor` 路径

## 任务描述

修复完整 Offline APK 中 `openai/_vendor` 被 Android Gradle assets 过滤的问题。当前
`openai/lib/ChatCompletionStream.mjs` 使用 `../_vendor/partial-json-parser/parser.mjs`，
但 APK 内置资源没有该目录，导致 Pi/Responses 聊天启动时报模块找不到。

## Design 需求

- 仅在完整 APK 的 assets 阶段把 `_vendor` 映射为安全目录名。
- 安装 Runtime 后恢复为标准 `node_modules/openai/_vendor`。
- 不修改生产依赖包、服务代码包或 Node 模块导入语句。
- 不增加模型、日志或其他 APK 资源。

## Spec 设计

1. `prepareAndroidNodeRuntime` 将 `node_modules/openai/_vendor/**` 的 APK 物理路径映射为
   `node_modules/openai/aasc-openai-vendor/**`，manifest 记录映射路径。
2. `NodeRuntimeInstaller` 安装并校验映射路径后，将目录恢复为 `_vendor`。
3. 测试检查构建输出、APK ZIP、安装器恢复和 OpenAI parser 导入路径。

## 受影响模块

- `scripts/ops/prepare-android-node-runtime.js`
- `src/apps/android-display/app/src/main/java/com/aasc/display/NodeRuntimeInstaller.kt`
- `tests/android-node-runtime-package.test.js`
- `src/apps/android-display/app/src/test/java/com/aasc/display/NodeRuntimeManifestTest.kt`

## 自测用例

- 生产依赖存在 `_vendor` 时，准备阶段生成安全 APK 路径。
- 生成的完整 APK ZIP 包含 parser 文件。
- 安装器恢复 `_vendor` 并删除安全目录。
- parser 文件内容和 SHA-256 校验保持一致。
- 依赖缺失时构建仍然失败。

## 兼容性测试

- Android Gradle assets 过滤规则。
- 已安装 Runtime 的版本复用路径。
- code/dependencies 热更新包的原始 `_vendor` 路径。

## 性能测试

- 只在首次完整 APK Runtime 安装时执行一次目录重命名。
- 不复制模型和大型依赖文件，不增加二次全量拷贝。

## 风险评估

- 如果恢复目录失败，完整 Runtime 安装必须失败并保留旧 Runtime 回滚能力。
- 旧 APK 不受影响；热更新依赖不经过 APK assets 映射。

## 预计工时

约 1 小时，包含定向测试、完整 APK 构建和 ZIP/安装路径校验。

## 完成结果

- ✅ 已完成构建器 marker 映射、嵌套 OpenAI 包兼容和 Android 安装器恢复。
- ✅ Node 定向测试 25/25 通过。
- ✅ Android `:app:testDebugUnitTest` BUILD SUCCESSFUL（25 个 JVM 测试任务通过）。
- ✅ 完整 Offline APK v22（`0.2.20-offline`）生成成功，大小 `1,012,056,819` bytes，SHA-256
  `92f4f14084bbe7a3c75cec2879de3f8f93616c0359ec6c953f035150319ca57e`。
- ✅ APK ZIP 全量 `unzip -t` 校验通过；顶层和 Pi SDK 嵌套包均包含安全 marker，未出现被 Gradle
  过滤的 `openai/_vendor` assets 路径。
- ℹ️ 本次未发布到 LAN/WAN，也未提交 APK、模型或构建中间文件。
