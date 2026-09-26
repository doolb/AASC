# MindAR Basic 固定矩形定位图裁剪

## 任务描述

修正已发布 MindAR Basic 自定义定位图的校准交互：不允许用户拖动四个角点；摄像头预览中预先显示居中矩形，四边各内缩 10%。用户移动设备将目标对准矩形后拍摄，程序直接裁取矩形区域，允许重拍但不再编辑选区。保存到 IndexedDB 并继续由 MindAR Compiler 编译；保留官方卡片与 Softmind 模型。

## Design / Spec

- `docs/design/mindar-basic-web.md`
- `docs/spec/mindar-basic-web.md`

## 受影响功能与文件

- `3rd/mind-basic/index.html`、`mind-basic.css`：实时视频上显示固定矩形框，照片后显示矩形裁剪预览和重拍按钮，移除四角编辑语义。
- `3rd/mind-basic/mind-basic.js`：将预置 10% inset 映射到实时视频帧，拍摄时裁矩形；保存 `{imageBlob,cropRect}` 并按矩形编译。
- `3rd/mind-basic/mind-basic-geometry.js`：实现矩形合法性/像素裁剪范围；旧版 `{selectedQuad}` 记录通过外接矩形兼容。
- `tests/mind-basic-custom-target.test.js`：覆盖固定矩形参数、裁剪范围、旧记录迁移和不含角点拖动交互。
- 同步更新 MindAR Basic README、usage、design/spec/task/todo/self-test/changelog。
- 重新发布 `https://c.aasc.us/mnt/mind-basic/` 的 HTML/CSS/JS/几何脚本，不修改 `/mnt/mmd-ar/`。

## 自测用例

- 打开拍摄弹窗时，固定矩形框与相机预览画面比例一致；旋转/改变视口后框仍覆盖正确像素区域。
- 拍照后预览图只含矩形框内像素；没有角点、pointer drag 或透视变换入口；重拍会重新打开摄像头预览。
- 保存后目标保存在 IndexedDB，开始定位仍由 MindAR Compiler 编译；官方模式与 Softmind 不变。
- 已保存的旧版 `selectedQuad` 数据加载后按四点外接矩形裁剪，不丢失/不删除已有记录。
- 定向 Node 测试、Chromium 模拟摄像头端到端和公网 HTTP/SHA-256 验证通过；`/mnt/mmd-ar/` 首页哈希保持不变。

## 兼容性、风险与预计工时

复用当前摄像头、IndexedDB 和 MindAR 1.2.5，无服务端或数据库升级。固定矩形覆盖画面中央 80%×80%，用户通过移动相机对准，不可单独调整尺寸或位置；相机原始帧与预览 UI 的比例映射需要在竖屏、横屏及窄视口验证。旧四角记录采用轴对齐外接矩形解释，不做透视矫正。预计 1–2 小时。

## 执行结果

- 本任务交付的拍前固定框行为后由 `docs/task/2026-09-25_MindAR-Basic裁剪编辑与面板收起.md` 按用户澄清修正：10% 矩形改为拍照后的默认值，并允许任意位置和尺寸的矩形裁剪。
- 已完成固定框和裁剪实现：实时预览使用四边内缩 10% 的矩形；用户移动设备对齐后拍照，直接裁剪，提供重拍，不再支持拖角或透视校正。新数据保存 `{imageBlob,cropRect}`；旧 `selectedQuad` 按外接矩形兼容读取。
- 定向测试 `node --test tests/mind-basic-custom-target.test.js tests/mind-basic-custom-target-browser.test.js`：6/6 通过；主脚本、几何脚本及浏览器测试 `node --check` 通过。
- Chromium 模拟摄像头端到端（本地与线上）通过：800×600 源帧得到 640×480 矩形预览，验证取景框比例、重拍、IndexedDB 保存及目标启动。另在已发布 HTTPS 页面调用真实 MindAR 1.2.5 Compiler 编译纹理测试目标，`.mind` 数据交接和启动通过；固定回归用例使用 Compiler stub 保证运行稳定。
- 已发布至 `https://c.aasc.us/mnt/mind-basic/`。首页/CSS/JS/几何脚本依次 SHA-256：`3a4079c06d73b76c13fc6fdb832e4b56963322f8710bec6f1f8f740e8a55a7b3`、`b501f0ef2dceb6ef380d39e69650bc57dd612db1add1c16f6267d004d3084525`、`eb0d36bcbf8a94163f725401de2877d1407fd064c3ae8ca9b9743125a262c421`、`165dbf853540dd13bc9dc6119db338701a728502a12de636cd5c687883fc1bea`，均与线上一致；`/mnt/mmd-ar/` 首页 SHA-256 仍为 `1bd94c8e6eacc9df5fd67359792639505ad8cf60f983c864b619a287ea1a3abd`。
- 手机真摄像头取景比例、真实图片首锁与模型对齐尚待现场验证，保留在 `docs/todo.md`。
