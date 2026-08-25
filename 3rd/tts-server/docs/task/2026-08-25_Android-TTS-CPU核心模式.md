# Android TTS CPU 核心模式

## 任务描述

为 `3rd/tts-server/android-tts` 增加自动、大核、小核三种 TTS 合成 CPU 模式，默认自动并持久化用户选择。

## Design 需求

- 动态读取 CPU capacity 或最大频率识别核心组。
- 只绑定 TTS 单线程执行器，不绑定 UI 线程。
- JNI 失败、设备无法识别大小核时回退自动模式。
- UI 显示当前模式和实际绑定/回退状态。

## Spec 设计

- Kotlin `CpuMode` 表示三种模式并验证持久化值。
- JNI `CpuAffinity.nativeApply()` 调用 `sched_setaffinity`，返回可读状态文本。
- `MainActivity` 在模型加载和每次合成前应用当前模式。
- CMake 仅构建 `arm64-v8a` 的 `libcpu-affinity.so`。

## 受影响功能和文件

- `3rd/tts-server/android-tts/app/src/main/java/com/aasc/tts/`：模式、JNI 桥接、Activity 状态。
- `3rd/tts-server/android-tts/app/src/main/cpp/`：CPU 核心识别和 affinity native 实现。
- `3rd/tts-server/android-tts/app/build.gradle.kts`：externalNativeBuild/CMake 配置。
- Android TTS 设计、spec、索引、todo 和 changelog。

## 自测用例

1. 默认启动为自动模式。
2. 选择大核/小核后重启 APK，选择保持。
3. 生成前应用所选 affinity，成功状态显示实际核心或回退原因。
4. 无 CPU capacity 节点时不崩溃，回退自动。
5. JNI 库不可加载时不崩溃，回退自动。
6. APK 包含 arm64 CPU affinity native 库，其他 ABI 不打包。

## 风险评估

- 不同厂商的 CPU sysfs 节点可能缺失或语义不同。
- Embedded Speech SDK 内部线程可能不完全继承当前线程 affinity。
- 大核模式可能增加功耗和热量，自动模式保持默认推荐。

## 执行记录

- ✅已完成 [2026-08-25][2026-08-25] Android TTS CPU 核心模式
  - 新增自动/大核/小核 Spinner，默认自动并通过 SharedPreferences 持久化。
  - 新增 `CpuAffinity` Kotlin/JNI 桥和 `cpu_affinity.cpp`，动态读取 CPU capacity/最大频率并调用 `sched_setaffinity`。
  - 模型加载和每次合成前应用所选模式，状态栏显示实际核心集合或自动回退原因。
  - 验证：`npm --prefix 3rd/tts-server run build:android-tts`、完整 Android JVM 测试通过；APK 包含 `lib/arm64-v8a/libcpu-affinity.so`。
