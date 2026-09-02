# AutoHelper Node.js 图片流程任务

## 任务描述

在 `/mnt/AASC/3rd/autohelper-node` 新建 Linux + Node.js + ADB + OpenCV 图片驱动自动化工具，兼容 `/mnt/tmp/autohelper` 的图片文件名参数，并增加 `goto@flowId` 多目录切换。

## 设计需求

- 图片目录是独立 Flow。
- 文件名描述识别阈值、队列、点击点、等待、延迟、循环和 `goto`。
- 当前只加载活动 Flow 的图片。
- 默认先以 dry-run 验证，不自动执行付款、广告或奖励领取动作。

## Spec 设计

实现伪代码见 `docs/spec/image-driven-adb-automation.md`，包含启动、图片解析、自动循环和目录安全校验。

## 受影响模块

- ADB 截图和点击客户端
- 文件名解析器
- Flow 目录加载和缓存
- OpenCV 图片匹配
- 动作排序、坐标计算和自动循环
- 截图生成、录制、inspect CLI

## 自测用例

- 文件名解析和 `goto` 安全校验
- 当前 Flow 只加载自身图片
- ADB 使用显式设备序列号
- 模板匹配、队列排序和点击点计算
- wait、dry-run、goto 和循环上限
- 截图生成路径安全校验

## 兼容性测试

- Linux x64
- Node.js 25
- `@techstark/opencv-js` 5.0.0-release.1 预编译 OpenCV.js/WASM
- ADB 设备 `192.168.1.6:5555`
- PNG 和 BMP 模板

## 性能测试

- 记录单轮截图、解码和匹配耗时。
- 默认循环间隔为 500 毫秒。
- 同一 Flow 内模板缓存只加载一次。

## 风险评估

- OpenCV.js 需要等待 Emscripten runtime 完成初始化；Node 的 CommonJS/ESM 互操作必须通过 `createRequire` 加载。
- 云游戏画面可能旋转或缩放，需要使用截图原始尺寸计算点击点。
- 阈值过低可能产生误点击，因此默认提供 dry-run 和人工 inspect。
- `goto` 目标缺失时停止，不继续使用旧 Flow 盲点。

## 预计工时

约 1 个工作日，包含单元测试、原生 OpenCV 安装验证和真实设备 dry-run。

## 当前进度

- [x] 工程初始化（配置、类型、测试框架和 AASC 文档已创建；`npm test`、`npm run build` 已通过）
- [x] 文件名解析器（支持旧参数和 `goto@flowId`，3 个解析测试通过）
- [x] Flow Loader（只加载活动目录并缓存模板，4 个测试通过）
- [x] ADB Client（显式 serial、二进制截图和坐标校验，3 个测试通过）
- [x] OpenCV Matcher（预编译 OpenCV.js/WASM、PNG/BMP 解码、模板匹配和可选 ORB，3 个测试通过）
- [x] 动作选择器（队列、阈值、select/default 和点击坐标，5 个测试通过）
- [x] 自动循环（点击、wait、dry-run、goto 和跳转上限，4 个测试通过）
- [x] 截图/裁剪工具（安全文件名、区域裁剪，3 个测试通过）
- [x] CLI（start/capture/record/inspect、参数退出码，29 个全量测试通过）
- [x] 设备只读检查（设备在线；当前前台为 `com.aasc.tts`，未发现无限暖暖应用包）
- [ ] 无限暖暖实际模板和 dry-run（等待游戏启动并停留在目标画面）
- [ ] 最终回归
