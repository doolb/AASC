# 2026-09-23 MMD 图片跟踪器 MindAR 对比测试

## 任务描述

在独立 MMD AR 测试 APK 内加入当前 JavaScript 图片跟踪器与 MindAR 的 A/B 选择和指标统计，用同一台设备、同一张已保存定位图比较准备/编译时间、首锁耗时、识别帧率、可见率、丢失次数和锚点抖动。生产显示端跟踪器保持不变。

## Design 需求

- 所有新运行时、界面和统计仅写入 `3rd/mmd-ar-test/` 独立 APK，不进入正式显示端、服务包、Offline APK 或生产依赖。
- MindAR 版本固定为 1.2.5；构建下载其入口脚本、Controller/UI chunk 和许可证时逐文件校验字节长度与 SHA-256，APK 离线运行不请求 CDN。
- 两种算法依次运行，不并行；复用同一套目标存储、参考图片及四角选区、摄像头入口、姿态到舞台的映射和 `DisplayMmd.setArPose`。
- 首锁计时从 tracker 开始初始化起算，不包含系统摄像头授权；当前 JS 的准备时间表示参考图特征提取，MindAR 的编译时间表示每轮目标矫正与编译，首次 MindAR 首锁另包含 APK 本地模块加载。
- MindAR 样本按真实 `processDone` 回调计数，不能重复采样旧 pose 冒充识别帧；可见率使用时间加权。测试页不伪造 MindAR 置信度。
- 锚点偏差会包含设备/目标真实移动，只有静止目标测试才近似代表定位抖动。
- 生成独立测试 APK 并在设备可用时安装/启动；不发布、不覆盖正式 APK，不构建服务包或完整 Offline APK。

## Spec 设计

- `docs/spec/mmd-ar-test-apk.md`：固定 vendor 文件验签、页面 tracker 包装、选区透视校正、MindAR Controller 初始化/释放和 A/B 指标伪代码。
- `docs/spec/mmd-image-ar.md`：记录生产 tracker 与独立评估 harness 的隔离边界。

## 受影响的功能模块与代码

- `3rd/mmd-ar-test/display-mmd-ar-benchmark.js`：测试页算法适配、MindAR Controller 到 AR pose 的转换、指标 UI 与置信度提示。
- `3rd/mmd-ar-test/display-mmd-ar-benchmark-metrics.js`、`tests/mmd-ar-benchmark-metrics.test.js`：时间统计与单元回归。
- `3rd/mmd-ar-test/build.js`：固定 MindAR 资产下载/缓存、哈希校验、页面注入与 APK 内容验收。
- `docs/design/mmd-ar-test-apk.md`、`docs/spec/mmd-ar-test-apk.md`、`docs/design/mmd-image-ar.md`、`docs/spec/mmd-image-ar.md`、`docs/self-test.md`、`docs/todo.md`、`changelog.md`。

## 自测用例

1. 当前 JS tracker 是默认选项；MindAR 只有选中后才动态加载。
2. 编译器使用保存图像及 `selectedQuad` 透视校正后的内容；运行中不得打开第二条摄像头流。
3. Controller 从 `processDone` 产出新样本；同一帧旧识别结果重复读取时不增加 FPS/可见率样本。
4. 首锁计时不含相机授权；成功识别后能更新角色 pose，停止后 Controller/当前 tracker 都能释放。
5. 时间加权可见率和丢失状态转换、首次识别、识别 FPS、静止锚点 RMS 由 Node 单测覆盖。
6. 构建 APK 验证独立包名、MindAR 和许可证资源 hash、模型清单及 APK ZIP/v2 签名；没有 server/Node 依赖。
7. 真机运行当前 tracker 与 MindAR 各一轮；记录测试条件和结果，检查灯光、PMX/VMD 和模型拖动没有回归。

## 兼容性测试

- 构建与静态逻辑至少在项目当前 Node/Gradle 环境通过。
- 目标设备 SM-N9500 / Android 9 / API 28；运行时 MindAR 资产本地加载，使用现有 Android WebView 摄像头授权能力。
- MindAR 初始化或 WebGL 后端不可用时，页面给出启动失败状态，仍允许停止会话并选择原 JS tracker；生产页面完全不受影响。

## 性能测试

- 记录 APK 增加体积、目标矫正/编译耗时、从 tracker 启动到首次识别时间、识别新样本 FPS、时间加权可见率、丢失次数和静止目标锚点 RMS。
- 记录 MMD/VMD 同时运行时的识别 FPS，并确保停止 tracker 后摄像头轨道关闭。
- 不先设定未实测的性能结论；WebView/GPU 与目标图样影响须在相同设备条件下报告。

## 风险评估

- MindAR 的 Controller 投影矩阵、图像局部坐标到显示端脚底锚点的转换可能不精确；通过独立适配器和静止/移动目标真机对照，禁止直接改生产姿态实现。
- MindAR 运行时代码使测试 APK 增大；只内置在专用测试 APK，不增加根 `package.json` 生产依赖或 Offline 包体。
- 两种识别算法产生样本的频率不同；使用 MindAR `processDone` 新结果、时间加权可见率，并在 UI 标明帧率口径。
- 普通纹理目标、反光、视角、设备运动会造成识别波动；A/B 必须复用目标并记录现场条件，锚点 RMS 只能在目标静止时当作抖动近似值。

## 预计工时

- 约 3–5 小时，含 MindAR vendor 校验、隔离适配器、页面指标、单元测试、APK 构建和设备冒烟；真实目标跟踪 A/B 需额外现场操作。

## 执行记录

- 已完成测试 APK 内的当前 JS/MindAR 1.2.5 算法切换、选区透视校正、真实识别样本计数、时间加权可见率和对比报告；MindAR 不提供置信度时使用明确文案。
- 已完成 MindAR 运行时代码和许可证的固定大小/SHA-256 校验，以及指标单测。
- `npm run build:apk:mmd-ar-test` 成功，独立 APK 为 `13,607,730` bytes，SHA-256 `7ece4967af75858667c1b300d8d9c5d2d893ee5cd08c4ed04094408cf508131c`；APK 资源验收确认 14 个模型文件及 6 个 A/B 资源齐全，ZIP 无损，`apksigner` 确认 v2 签名有效。
- ADB 覆盖安装 SM-N9500 / Android 9 / API 28，并启动到 display 0；截图确认米娅 PMX、定位面板与算法选择 UI 正常，JS/MindAR 选项可切换。MindAR 入口、Controller、UI 资源通过临时回环转发读取，响应哈希与构建清单一致；端口转发随后删除。
- `node --check` 覆盖构建脚本和两个新增 JS 文件通过；`node --test tests/mmd-ar-benchmark-metrics.test.js` 为 4/4；`git diff --check` 通过。
- 未在本轮请求相机权限或开始环境采集；实际跟踪锁定和性能数值需拿同一张纹理目标在真机现场完成，不能用本次 UI 冒烟代替。
