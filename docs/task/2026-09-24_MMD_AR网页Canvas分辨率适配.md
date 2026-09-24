# MMD AR 网页 Canvas 分辨率适配

## 任务描述

使独立 HTTPS MMD AR 测试页在视口、方向和舞台尺寸变化时重新设置 Canvas，并在测试网页与正式显示端的灯光面板“灯光设置”后显示当前 MMD 渲染分辨率。独立测试 APK 后续不维护。

## Design 需求

- 显示真实绘制缓冲宽×高像素，而不是仅显示 CSS 视口或设备标称分辨率。
- 舞台尺寸、窗口、浏览器 visualViewport 或设备像素比变化时同步更新。
- 重复事件不反复重建相同尺寸的 WebGL 缓冲；正式显示端复用现有 resize 流程，独立测试 APK 不再维护。

## Spec 设计

- `docs/spec/mmd-ar-test-apk.md` 的 HTTPS 网页 Canvas 适配伪代码说明监听、尺寸计算、现有 resize 调用和诊断文字同步。

## 影响模块与代码

- `3rd/mmd-ar-test/build.js` 仅在网页模式生成舞台/视口尺寸监听脚本。
- `display.html` 的灯光标题增加实际渲染尺寸文字，`display-mmd-lighting.js` 观察 Canvas 属性变化同步更新；正式显示端与网页共用。
- 复用 `DisplayMmd.resize()` 和 PMX runtime 的现有像素比上限、相机/AO resize，不修改 APK Java 代码。
- 同步 design/spec/todo/changelog/README/usage/self-test。

## 自测与兼容性

1. `npm run build:web:mmd-ar-test` 成功，测试网页复用正式显示端灯光面板的诊断文字；不再构建 APK。
2. 浏览器模拟不同宽高与 DPR，断言 `canvas.width/height`、面板文字及舞台宽高匹配。
3. 模型加载前后、竖屏/横屏和灯光面板打开后均显示准确；灯光/定位按钮可点击。
4. 不改 AR 画面、相机授权或模型清单；真机方向变化与 GPU 资源表现待现场确认。

## 性能与风险

- 屏幕旋转时 WebGL 绘制缓冲与 AO 纹理需重新分配；相同尺寸事件跳过，避免不必要的重建。
- PixelRatio 仍限制在 1–2；高 DPI 设备显示的是实际渲染像素，不承诺全物理分辨率。
- 预计约 1 小时，含浏览器回归、文档和 HTTPS 更新。

## 执行结果

- `npm run build:web:mmd-ar-test` 成功；正式 `display.html` 与独立网页共用渲染分辨率文字和 Canvas 属性监听，网页单独增加视口/舞台 resize。
- 浏览器测试：390×844、DPR 3 → Canvas/文字 780×1688；844×390、DPR 1.5 → 1266×585；模型 ready 后横屏检查、灯光面板打开均通过，页面无脚本错误。
- HTTPS 网页已重新发布并通过线上竖横屏切换检查；正式显示端需随下次服务代码包发布，独立测试 APK 不再维护或出包。
