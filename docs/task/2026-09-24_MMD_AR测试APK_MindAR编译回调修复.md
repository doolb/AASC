# 2026-09-24 MMD AR 测试 APK MindAR 编译回调修复

## 任务描述

独立 MMD AR 测试 APK 中摄像头预览正常，但 MindAR 未能进入目标识别。MindAR 1.2.5 的 `Compiler.compileImageTargets` 需要进度回调，适配器此前未传该参数，编译阶段因此中断。

## Design 需求

- 修复范围仅限 `3rd/mmd-ar-test/` 独立测试 APK，不修改正式显示端默认跟踪器、Offline APK 或服务端。
- MindAR 编译定位图时必须传递有效进度回调，将进度反馈到定位状态和 A/B 提示。
- 编译或初始化失败时呈现可读错误原因；只有编译成功、Controller 初始化完成后才提示正在寻找定位图。

## Spec 设计

- 先更新 `docs/spec/mmd-ar-test-apk.md` 第 7 节 MindAR 流程伪代码，声明进度回调和失败终止语义。
- 编译适配器校验编译器及回调契约，再把进度回调传至 MindAR；页面显示百分比和异常摘要。

## 受影响的功能模块与代码

- `3rd/mmd-ar-test/display-mmd-ar-benchmark-compiler.js`：MindAR 必需编译进度回调契约。
- `3rd/mmd-ar-test/display-mmd-ar-benchmark.js`：编译进度展示和启动错误提示。
- `3rd/mmd-ar-test/build.js`：将新适配器复制并验收进 APK。
- `tests/mmd-ar-benchmark-compiler.test.js`：编译回调契约回归。
- `docs/design/mmd-ar-test-apk.md`、`docs/spec/mmd-ar-test-apk.md`、`3rd/mmd-ar-test/README.md`、`docs/todo.md`、`docs/self-test.md`、`changelog.md`。

## 自测用例

1. 模拟 MindAR 编译器断言收到函数形式的进度回调，并验证回调进度可透传。
2. 未提供进度处理回调时，适配器拒绝调用编译器。
3. 编译失败后 A/B 提示显示错误，流程不得进入寻找定位图。
4. 构建 APK 并校验包名、模型清单、MindAR 资源及 A/B 脚本数量。

## 兼容性测试

- Node.js 定向单测及 JS 语法检查通过。
- APK 构建保持 Android 8/API 26 以上、WebView 和现有摄像头权限流程不变。
- 当前 ADB 设备为 SM-N9500 / Android 9/API 28；用户报告的外部 Android 13 设备无法通过 ADB 连接，真实目标首锁需现场复测。

## 性能测试

- 编译进度回调只更新少量状态文本，不新增摄像头帧处理工作或识别线程。
- APK 大小与构建前比较并记录；回归场景不伪造首锁或性能数据。

## 风险评估

- 进度回调若传递非数值内容，不更新百分比，但编译流程仍由 MindAR 控制。
- 修复编译阶段并不证明实体目标一定可识别；目标纹理、选区、光线、设备 WebGL 和姿态映射仍需真机验证。
- 修改仅随独立 MMD AR 测试 APK 打包，不进入 Offline 生产包。

## 预计工时

- 约 30 分钟，包含适配器、回归测试、文档、APK 构建和内容校验；实体目标现场首锁测试另需设备与可控定位图。

## 执行结果

- `node --test tests/mmd-ar-benchmark-compiler.test.js tests/mmd-ar-benchmark-metrics.test.js`：6/6 通过。
- 编译适配器、benchmark、build 脚本和测试 `node --check` 通过；差异空白检查通过。
- `npm run build:apk:mmd-ar-test` 成功；APK `13,620,450` bytes，SHA-256 `54e4e2be3acfbf56dff1b59259c05410ab0dc657d3deab8f02114b971a39a985`；构建内容校验确认 applicationId=`com.aasc.mmdartest`、14 个模型文件和 7 个 A/B 资源。
- 已覆盖上传外网 `http://120.79.245.103/mnt/aasc-offline/apk/aasc-mmd-ar-test.apk`；SSH 远端文件与公网下载响应均为 `13,620,450` bytes，SHA-256 与本地一致，HTTP 返回 200；未修改服务 `manifest.json`。
- MindAR 实际相机编译进度和定位图首锁仍未在设备上验证；本次仅更新并发布 APK。
