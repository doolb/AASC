# Android MNN 预编译运行包入库

## 任务描述

将当前 Android `arm64-v8a` MNN-LLM 构建成果作为版本化、自包含的编译输入入库，使新 clone 能编译 APK，而无需下载或重新编译 MNN 上游。MNN native 库保持当前 revision 与摘要；本任务不重建 min APK。

## design 需求

- 固定包目录为 `3rd/android-mnnllm-prebuilt/<revision>`。
- 包含 `libMNN.so`、编译 AASC bridge 所需的 MNN 头文件、官方 MnnLlmChat C++ bridge 源码、第三方编译头文件、上游许可证和 `manifest.json`。
- 清单记录 revision、ABI、NDK/构建选项、库路径、文件大小和 SHA-256。
- APK 默认准备流程只校验并使用 Git 内置包；源码构建和版本包生成保留独立 npm 入口。
- 缺少依赖、摘要不匹配或版本不匹配时失败关闭；不得静默从网络回退下载。
- 本次运行库内容不变，`release/offline-release-status.json` 的 `minApk` 保持 `false`，不构建或发布 APK。

## spec 伪代码

```text
prepareMnnLlmNative:
  resolve pinned revision and default package root
  read manifest and require matching revision/arm64-v8a ABI
  require library size and SHA-256 match manifest
  require every bridge source/header directory used by CMake exists
  pass package root and revision to Gradle/CMake
  fail with the missing or mismatched path; do not fetch MNN upstream

buildMnnFromSource:
  use build/third_party/MNN and the pinned revision
  configure and compile MNN with the established Android options

packageMnnForGit:
  require source-built libMNN.so and all compile-time dependencies
  copy required files to a new revision-specific package directory
  write ABI/build metadata, library size and SHA-256
  refuse to overwrite an existing version package
```

## 受影响模块、文件与资源

- MNN 共享构建配置、预编译包校验、源码编译与版本包生成脚本。
- Android Gradle/CMake 对默认 MNN root、revision 和包清单的检查。
- `3rd/android-mnnllm-prebuilt/<revision>/`：运行库、头文件、LLM 源码、第三方头文件、许可证与摘要清单。
- MNNChat design/spec、任务记录、待办和 changelog。
- 不修改 MNN JNI 业务逻辑、模型资源、APK profile 或发布状态。

## 自测用例

- 预编译包清单 revision、ABI、库大小和 SHA-256 均与文件一致时准备成功。
- 修改库内容、清单 revision、ABI 或大小时准备失败并指出具体差异。
- 缺少 bridge 源码或头文件时 CMake 配置失败，不访问 MNN 上游。
- 默认新 clone 路径只读取 Git 包；显式源码构建仍使用固定 revision 和既有 Android build flags。
- 包生成器把必要目录、许可证和库复制到新 revision 包，并拒绝覆盖旧包。
- 定向构建命令与既有 MNN 配置契约一致。

## 兼容性测试

- `build-apk.js` 与直接 Gradle 构建都解析相同的 package root/revision。
- `AASC_MNN_ROOT` 和 `AASC_MNN_REVISION` 覆盖入口继续可用。
- APK ABI 仍为 `arm64-v8a`，Android API 和 ELF 16 KB page-size 约束保持不变。
- 不构建完整 APK、Offline min APK或发布包；min APK 后续仍可沿用当前签名 profile。

## 性能测试

- 比较准备流程：新 clone 不再编译 MNN 本体；只校验包并编译 AASC bridge。
- 记录 Git 包实际未压缩大小及 `libMNN.so` 摘要；本次不测模型推理性能。

## 风险评估

- 包 revision、ABI、构建选项与头文件必须匹配，否则可能在链接或设备加载时失败。
- Git 包比单个 `.so` 大，包含第三方开源头文件，需保留上游许可证和 revision 来源。
- 本次不出 min APK，所以不提供新的签名 APK 或真机安装验收；新 clone 的完整 APK 构建仍需后续执行确认。

## 预计工时

约 1 个工作日，含打包器、校验、构建入口和文档更新；不含新 clone 的完整 APK/设备验收。

## 执行结果

- 生成 `3rd/android-mnnllm-prebuilt/d407447ed56c4121a11ccbd266dc184ca1ead0c2/`，约 26 MiB；`libMNN.so` 为 7,686,792 bytes，SHA-256 为 `5b3ad20b47211f59bccba9cceaae3aa998d65f33316e3e884b6125bce0f85dcd`。
- APK 默认配置指向版本化 Git 包；prepare 校验 manifest、revision、ABI、库大小/SHA-256 和 bridge 编译依赖。源码构建命令仍保留，并新增生成版本化包的 npm 入口。
- 更新 `scripts/ops/mnn-build-config.js`、`prepare-mnnllm-android.js`、新增 `package-mnnllm-android.js`、`package.json`、Android Gradle/CMake 和既有 `tests/mnn-build-command.test.js` 契约。
- design/spec/task/changelog/todo 已同步。未运行测试、未执行 APK/Gradle 构建；新 clone 完整 APK 构建待验收。`release/offline-release-status.json` 未改动，`minApk=false`。
