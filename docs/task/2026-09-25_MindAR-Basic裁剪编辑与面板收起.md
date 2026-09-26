# MindAR Basic 矩形裁剪编辑与控制面板收起

## 任务描述

修正自定义定位图流程：拍摄完整相机帧后才显示裁剪框，默认四边内缩 10%；用户可移动选区，并拖动边/角任意调整尺寸，选区始终为不旋转、不透视变形的轴对齐矩形。MindAR Basic 上方控制面板增加收起/展开，页面初始默认展开。

## Design / Spec

- `docs/design/mindar-basic-web.md`
- `docs/spec/mindar-basic-web.md`

## 受影响功能与文件

- `3rd/mind-basic/index.html`、`mind-basic.css`：照片裁剪编辑器覆盖整帧预览，展示矩形边/角控制点；控制面板提供折叠按钮和紧凑展开入口。
- `3rd/mind-basic/mind-basic.js`：保存完整拍摄帧，初始化 10% inset cropRect，处理触屏/鼠标拖动、边界约束与叠加框刷新；确认时仍保存 `{imageBlob,cropRect}`。面板默认展开并同步 `aria-expanded`。
- `3rd/mind-basic/mind-basic-geometry.js`：新增矩形平移及边/角缩放计算，保持非零矩形并约束到图片边界；继续兼容旧 `{selectedQuad}` 数据。
- `tests/mind-basic-custom-target.test.js`、`tests/mind-basic-custom-target-browser.test.js`：覆盖几何边界、默认矩形、拖动移动/缩放、完整帧裁切、重拍/保存、面板初始与折叠状态。
- 同步 `3rd/mind-basic/README.md`、`docs/usage.md`、design/spec/task/todo/self-test/changelog。
- 更新 `https://c.aasc.us/mnt/mind-basic/`；不修改 `/mnt/mmd-ar/`、正式显示端、APK 或服务器功能。

## 自测用例

- 拍照前完整显示摄像头画面，不叠加裁剪框；拍照后完整照片显示 10% 内缩初始矩形。
- 拖动框内移动选区；拖动四角和四边改变位置/大小；选区始终为轴对齐矩形且处于图像范围内。
- 变更选区后仅更新完整照片上的蓝色叠加框，不显示单独缩略图；保存的 cropRect 与选区一致；重拍后恢复摄像头并重新初始化默认框。
- 自定义目标仍能保存、加载、经 MindAR Compiler 编译并启动；旧四角记录按轴对齐外接框读取。
- 面板初次加载展开；可收起至紧凑入口并再次展开，ARIA 状态与显示状态一致。
- 定向单元/浏览器测试通过；线上资源哈希与本地一致；MMD AR 页面哈希不变。

## 兼容性、性能与风险

复用现有摄像头、IndexedDB 和 MindAR Compiler，不迁移数据库结构；`imageBlob` 仍为完整原图、`cropRect` 为归一化矩形。拖动基于 Pointer Events，覆盖触屏与鼠标；手柄需保证手机触摸命中面积。极窄或缺少纹理的裁剪区域可能无法由 MindAR 编译，需显示现有编译错误并允许重新调整。编辑时只移动/缩放叠加框，开始定位时才裁剪源照片矩形区域，不进行透视变换。预计 1–2 小时。

## 执行结果

- 已完成并发布。拍摄后保留完整帧，默认叠加四边内缩 10% 的蓝色裁剪框；可拖动框体移动，拖动四边/四角任意调整大小，选区始终轴对齐为矩形；不再显示单独的结果缩略图。控制面板默认展开，可折叠为紧凑入口并重新展开。
- `node --check` 通过；定向测试 `node --test tests/mind-basic-custom-target.test.js tests/mind-basic-custom-target-browser.test.js`：8/8 通过。390×844 Chromium 模拟相机验证蓝框叠加、移动、缩放、重拍重置、保存、面板折叠状态；真实 MindAR 1.2.5 Compiler 本地和 HTTPS 页面均编译调整后的纹理目标并启动成功。
- 已更新 `https://c.aasc.us/mnt/mind-basic/`。首页/CSS/JS/几何脚本 SHA-256：`c04e5dc27499af557112001b0a0e17951c57edf02fceaba9854abe90006b7446`、`388c228dbae5dffe176341e5206ee939a3d28c85647863a3cb28361f06073d36`、`297fcdd1f3bfcfbb5cf2fc091fd179f106722dc79652f0fdc3995b2d6fce72ca`、`ceb2f1f9f900c1eac34d34b31e20ed26ec69d5e1e83943a018f6f1df7750f6f9`，线上与本地一致；`/mnt/mmd-ar/` 首页哈希保持不变。
- 真机触摸命中、实际摄像头取景与识别、模型对齐尚未验证，保留在 `docs/todo.md`。
