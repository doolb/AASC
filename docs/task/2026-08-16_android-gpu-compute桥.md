# 2026-08-16 Android 显示端 GPU Compute 桥（GLES 3.1 离屏计算）

## 任务描述

在现有 android-display APK 的 NativeBridge 上新增 `compute()` 桥方法，用离屏 EGL 3.1 上下文执行 GLES compute shader，为 threejs 提供真 compute shader（协作/归约类并行计算）能力。结果支持数值/图像两种回传。

## 设计需求

- JS 动态传 GLSL ES 3.10 shader 源码，原生运行时编译执行
- 接口命名/语义对齐 threejs WebGPU compute（`compute`/`computeKernel`/`ComputeNode`）
- 结果回传：数值（Float32Array）/ 图像（dataUrl）
- 定位低频批量任务，非每帧

## Spec 设计

- 详见 `docs/spec/android-compute-bridge.md`
- ComputeEngine：离屏 EGL 3.1 上下文 + 编译 + SSBO + dispatch + 两种读回
- NativeBridge.compute：后台 GL 线程 + CountDownLatch 超时兜底

## 已实际改动代码

| 文件 | 改动 |
|------|------|
| `src/apps/android-display/.../ComputeProtocol.kt` | 新增：请求解析/校验、ImageFormat 枚举、dispatch 计算 |
| `src/apps/android-display/.../ComputeEngine.kt` | 新增：离屏 EGL 3.1 compute 引擎（SSBO/image2D/两种读回） |
| `src/apps/android-display/.../ComputePixels.kt` | 新增：glReadPixels 行翻转 + 各格式归一化 → ARGB int |
| `src/apps/android-display/.../NativeBridge.kt` | 修改：新增 `compute()` 桥方法（JSONObject 错误序列化） |
| `src/apps/android-display/app/src/test/.../ComputeProtocolTest.kt` | 新增：8 个 JVM 用例 |
| `src/apps/android-display/app/src/test/.../ComputePixelsTest.kt` | 新增：5 个 JVM 用例 |
| `src/apps/web-mediacenter/ui/public/js/native-compute.js` | 新增：NativeCompute 封装（TypedArray 归一化 + JSON.try-catch） |
| `src/apps/web-mediacenter/ui/public/display.html` | 修改：引入 native-compute.js |

## 验证结果（三星 Note 8 / Android 9 / display 2）

- 编译：`./gradlew :app:assembleDebug` → BUILD SUCCESSFUL
- 单测：`./gradlew :app:testDebugUnitTest` → 13/13 通过（ComputeProtocolTest 8 + ComputePixelsTest 5）
- 真机数值冒烟：`Float32Array[1,2,3,4]` shader ×2 → `[2,4,6,8]` ✅（原生桥与 NativeCompute 封装均过，含 TypedArray 归一化）
- 真机图像冒烟：`rgba32f` writeonly image2D → 合法 PNG dataUrl ✅（shader 写 y=0 蓝 / 底红 → PNG 上红下蓝，行翻转 + R/B 通道修正正确）
- 真机编译失败：坏 shader → 合法 JSON `{"error":"shader 编译失败: ..."}` ✅（JSONObject 序列化 + JS JSON.parse try-catch）
- 关键发现（已记入 design/spec）：①`EGL_CONTEXT_CLIENT_VERSION=3` 只拿 3.0，须 KHR 大/小版本属性拿 3.1；②`rgba32f` 等浮点 storage image 需 `writeonly`/`readonly` 限定（read-write 编译失败）；③`glReadPixels` 自底向上，读回需行翻转
- count 与 dispatchSize 互斥：JS 封装 throw 路径，代码覆盖（真机未单独复跑）

## 自测用例

1. 数值冒烟：输入 `[1..N]` ×2，验证返回翻倍 ✅
2. 图像冒烟：shader 生成渐变，验证 dataUrl 尺寸/内容 ✅
3. 编译失败：坏 shader 返回编译日志 ✅
4. 超时兜底：超大 workgroup 返回超时 error（代码路径覆盖）
5. count 与 dispatchSize 互斥报错 ✅

## 待确认事项

- 无（接口形态、技术路线、读回模式均已确认；真机验证期间发现的 shader 限定要求已记录）
