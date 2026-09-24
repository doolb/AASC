# MMD AR 测试 APK MindAR 状态与竖屏提示布局修复

## 任务描述

用户反馈选择 MindAR 后相机画面已经显示，但界面仍停留在“请求摄像头权限”；竖屏时顶部说明文字会覆盖右上角灯光按钮。修复仅限独立 `3rd/mmd-ar-test/` 测试 APK，不改生产显示端共享状态机和正式 APK。

## Design 需求

- 共享摄像头就绪后、MindAR 目标编译前，把定位状态从权限等待推进至 MindAR 准备阶段。
- A/B 状态提示同步说明当前准备阶段；控制器启动后提示寻找定位图，异常继续由现有共享错误状态处理。
- 竖屏测试提示为灯光按钮和系统安全 Insets 预留空间，并允许说明文本换行；横屏保持现有布局。

## Spec 设计

已更新 `docs/spec/mmd-ar-test-apk.md` 第 7 节伪代码：摄像头已就绪 → MindAR 准备/编译 → 引擎启动/寻找定位图；并规定竖屏提示避让灯光按钮。

## 受影响模块与代码

- `3rd/mmd-ar-test/display-mmd-ar-benchmark.js`：更新 MindAR 准备和启动状态。
- `3rd/mmd-ar-test/build.js`：为竖屏测试提示设置灯光按钮避让边界。
- `3rd/mmd-ar-test/README.md`。
- `docs/design/mmd-ar-test-apk.md`、`docs/spec/mmd-ar-test-apk.md`、`docs/todo.md`、`docs/self-test.md`、`changelog.md`。

## 自测用例

1. 选择 MindAR，权限完成且摄像头视频就绪后，编译期间不再显示“请求摄像头权限”。
2. MindAR 控制器启动后显示正在寻找定位图；启动失败仍显示错误原因。
3. 竖屏顶部提示不与灯光按钮重叠，窄屏可换行；横屏位置保持不变。
4. `npm run build:apk:mmd-ar-test` 成功，APK 安装后 Activity 正常启动，PMX 与灯光控件可见。

## 兼容性测试

- 保持旧 Android WebView 兼容，不使用容器查询或新式平台专属 Insets API；竖屏布局使用普通媒体查询和当前 CSS Insets 自定义属性。
- 不改变 CAMERA 权限申请时机、不增加权限和网络访问。
- 在当前连接的 Android 设备安装冒烟；Android 13/iQOO Z5x 以及实际相机图片跟踪仍需该设备现场复测。

## 性能测试

- 状态更新仅为少量 DOM 文本赋值；CSS 只影响测试提示布局，不改变视频、跟踪或渲染处理。

## 风险评估

- 实际 MindAR 编译与首锁需要摄像头权限、已保存定位图及可识别目标；无真实交互时只能验证阶段文案和构建，不能宣称跟踪通过。
- 竖屏右侧保留按钮实际宽度、按钮边距与 Insets；极窄设备文案会折行，可能增加提示高度但不遮挡控件。

## 预计工时

- 实现、文档和构建约 30 分钟；设备侧相机 A/B 验收依赖用户提供可追踪图像和现场操作。

## 执行结果

- `node --check 3rd/mmd-ar-test/display-mmd-ar-benchmark.js` 与 `node --check 3rd/mmd-ar-test/build.js` 通过。
- `npm run build:apk:mmd-ar-test` 成功；14 个模型资源和 6 个 MindAR A/B 资源通过构建校验。APK 为 `13,620,354` bytes，SHA-256 `3409e3e6a182339118b5cc09a32ce3e5ca0aea46a6e9e5bbe45f980dc548174e`。
- 已覆盖安装至 SM-N9500 / Android 9/API 28，`MainActivity` 在 display 0 前台运行。临时切换竖屏并截图，提示与灯光按钮无重叠；测试后恢复设备自动旋转原设置。
- MindAR 的摄像头授权后编译、实际目标首锁/跟踪尚未测试；未发布 APK 到内外网，未改 Offline 服务包或发布清单。
