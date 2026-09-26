# MindAR Basic 自定义图片定位

## 任务描述

在 MindAR Basic 独立网页中增加与 MMD AR 一致的自定义图片标记工作流：用户主动拍照、拖动四角校正、命名并保存在本浏览器 IndexedDB；启动定位时在浏览器内编译目标，并将现有 Softmind 动画模型锚定到自定义图片。保留官方示例卡片及官方示例模式，不上传用户照片，不修改 MMD AR、正式显示端、APK 或服务端。

## Design / Spec

- `docs/design/mindar-basic-web.md`
- `docs/spec/mindar-basic-web.md`

## 受影响功能和文件

- `3rd/mind-basic/index.html`：保留官方 A-Frame 场景和 Softmind 模型，新增目标选择、状态/进度、拍照校准界面。
- `3rd/mind-basic/mind-basic.js`：实现摄像头生命周期、四角校验/透视校正、IndexedDB、自定义 MindAR 编译、目标切换及 A-Frame system 重启。
- `3rd/mind-basic/mind-basic.css`：手机安全区、校准画布和控制面板布局。
- `3rd/mind-basic/mind-basic-geometry.js`：复用四角凸性/边界/面积校验，供页面和 Node 测试使用。
- `tests/mind-basic-custom-target.test.js`：覆盖页面结构、选区几何、保存恢复与 MindAR system 切换契约。
- `docs/design/mindar-basic-web.md`、`docs/spec/mindar-basic-web.md`、`docs/task/2026-09-25_MindAR-Basic自定义图片定位.md`、README、usage、ref、todo、self-test、changelog。
- 外网仅更新 `/var/www/html/mnt/mind-basic/` 对应页面资源；不触碰 `/mnt/mmd-ar/`。

## 自测用例

- 默认官方 card.mind 可启动，Softmind 模型及卡片平面保持正常。
- 相机只在用户点击拍摄后申请；拍摄后能拖动四角，非凸/过小区域不可保存。
- 保存的目标照片和选区仅在 mind-basic origin 的 IndexedDB 持久化；刷新后可见、选择、删除。
- 开始自定义定位时 Compiler 显示进度并输出目标；MindAR 1.2.5 A-Frame system 切换到编译结果后发出 arReady。
- 自定义目标首锁时 Softmind 模型锚定正确；切回官方目标、停止、重试和删除不遗留摄像头轨道或 Blob URL。
- 外网首页、JS、CSS 返回 HTTP 200 且 SHA-256 与本地一致；mind-basic 页面改动不影响 mmd-ar。

## 兼容性、风险与预计工时

复用 A-Frame 1.5.0、MindAR 1.2.5 和浏览器 IndexedDB，不新增服务端 API。相机校准流和 A-Frame 跟踪流按顺序开关。MindAR A-Frame system 必须在停止旧 Controller 后读取新的 `imageTargetSrc` 再启动；编译目标通过 Blob URL 提供，需覆盖系统重启和 Blob 生命周期。Core API 版本固定并以浏览器校验为准。手机首次编译可能耗时，显示进度和错误；浏览器清站点数据会删除用户目标。预计 2–4 小时。

## 执行结果

- 已按 design/spec 实现独立几何模块、校准 UI、IndexedDB 保存、MindAR Compiler 编译进度及 A-Frame system 切换。保留官方卡片、Softmind 模型和署名；没有修改 MMD AR 或正式显示端。
- `node --check`、`node --test tests/mind-basic-custom-target.test.js`（3/3）和 `git diff --check` 通过。Chromium 模拟摄像头端到端完成拍照、拖动角点、保存、真实 MindAR 1.2.5 编译、`.mind` Blob URL 切换后 `arReady`、停止；目标 IndexedDB 记录数为 1。
- 已发布到 `https://c.aasc.us/mnt/mind-basic/`：`index.html`（5,221 bytes，SHA-256 `96c364658e531f4d7c6201bb7a9c08362cf7d77fa47c17e463a51fa0f98432fb`）、`mind-basic.js`（32,274 bytes，`0f44af251491f3b9eff300b410c21738e528b330f2518c145d3a63a920691d09`）、`mind-basic.css`（5,273 bytes，`b44f651438eebb45a8adf47d39a312d8b5d0dfd5b1bbc227fea62ba7d20f8126`）、`mind-basic-geometry.js`（1,755 bytes，`a5508673435859eeddfd7d832c61542ca19ef6179b9d74336e366453c2b3a2e7`）；四个公网下载哈希均与本地一致且 HTTP 200。外网 Chromium 模拟摄像头再次完成自定义编译、停止及 resize 回归且无页面异常；`/mnt/mmd-ar/` 首页 SHA-256 保持 `1bd94c8e6eacc9df5fd67359792639505ad8cf60f983c864b619a287ea1a3abd`。
- 真实手机摄像头首锁、目标边角触控和长时间资源释放需现场验收。
