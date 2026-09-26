# MMD AR 测试网页接入 MindAR Basic 锚点定位

## 任务描述

将 `/mnt/mmd-ar/` HTTPS 测试页的定位流程从自定义 MindAR Controller 和绿色中心点，替换为 MindAR Basic 的 A-Frame 目标锚点。在定位图上显示半透明蓝色矩形和中心十字，随目标平面移动、旋转和缩放；目标丢失时隐藏。保留现有 MMD 页面、校准、目标图持久化及切换入口。独立 APK 和正式显示端不切换引擎。

## Design / Spec

- `docs/design/mmd-ar-test-apk.md`
- `docs/spec/mmd-ar-test-apk.md`

## 文件与实现

- `3rd/mmd-ar-test/build.js`：只在 WEB_MODE 引入 A-Frame 1.5.0 和 MindAR 1.2.5 A-Frame 组件，生成锚点及蓝色图形，加载网页专用适配器；保留 APK 分支。
- `3rd/mmd-ar-test/display-mmd-ar-aframe.js`：复用已有目标图裁剪/编译，启动、停止 A-Frame system，响应 arReady/targetFound/targetLost，管理单条摄像头流、临时 URL 与 resize 监听器。
- `3rd/mmd-ar-test/display-mmd-ar-benchmark.js`：网页 A-Frame 分支仅导出已验证的定位图编译能力；APK 继续使用原 A/B 跟踪器。
- `src/apps/web-mediacenter/ui/public/js/display-mmd-ar.js`：网页模式开始定位前释放校准相机，并消费 A-Frame 锚点状态，不改正式显示端默认行为。
- `tests/mmd-ar-web-tracking.test.js`：模拟摄像头验证锚点识别/丢失、蓝色矩形、单相机与停止清理。

## 自测、兼容、性能与风险

- 执行 `npm run build:web:mmd-ar-test`，以及相关 Node 和 Chromium 定向测试。
- 验证内置卡片和自定义图的编译/定位；切换、取消、停止、关闭摄像头及页面离开时没有残留轨道、Controller、Blob URL 或 resize 监听。
- A-Frame 使用原始摄像头分辨率，网页旧 Controller 识别分辨率滑块不适用；高分辨率设备需现场确认流畅度。
- 目标遮挡、快速运动时锚点可能抖动；真机识别与图形透视对齐需现场验收。

## 执行结果

已完成并发布到 `https://c.aasc.us/mnt/mmd-ar/`。`npm run build:web:mmd-ar-test` 成功；本地与线上 Chromium 模拟相机使用官方 `.mind` 与仓库 `testimg/mindar.JPG` 实际触发 `targetFound`、`targetLost`，检查蓝色矩形/十字、单相机申请和停止后视频/Controller 释放；自定义图由既有编译器生成临时 `.mind` URL 后可重启 A-Frame。`tests/mmd-ar-web-tracking.test.js` 本地和线上各 1/1 通过；校准、面板与阴影定向回归 16/16，编译/指标测试 6/6；相关 JS 语法和 `git diff --check` 通过。只上传首页与 3 个更新脚本，外网 55 个当前构建资源 SHA-256 均与本地一致；遗留隐藏文件未删除。真机识别、透视视觉对齐和高分辨率性能待验收。
