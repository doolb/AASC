# MMD AR 测试页 HTTPS 部署

## 任务描述

将 `3rd/mmd-ar-test/` 的独立 APK 测试页面另行构建为可通过 `https://c.aasc.us/mnt/mmd-ar/` 打开的静态网页；APK 构建流程保留，网页不依赖 AASC 服务。

## Design 需求

- 复用默认米娅 PMX、VMD、灯光、布料物理、拖动旋转和当前 JS/MindAR 图片跟踪对比。
- 模型、MindAR 和运行时文件同源提供；浏览器按需请求摄像头权限。
- 仅调整网页构建副本的资源路径，不改变生产显示端或 APK 原有路径。

## Spec 设计

- `docs/spec/mmd-ar-test-apk.md` 的 HTTPS 静态网页伪代码说明构建、资源路径映射、发布和校验。

## 影响模块与代码

- `3rd/mmd-ar-test/build.js` 增加 `--web` 模式，生成 `web-dist/`；`.gitignore` 排除产物。
- `package.json` 增加 `build:web:mmd-ar-test`。
- 更新 README、design/spec 索引、使用/自测文档、todo 与 changelog。

## 自测与兼容性

1. npm 构建网页，核对 14 个模型资源和 MindAR 文件复用固定 SHA-256 清单。
2. 检查生成文件没有遗留根路径 `/api/mmd`、`/js`、`/css` 或 `/models/mmd`，同源路径均带 `/mnt/mmd-ar/` 前缀。
3. HTTPS 请求首页、清单、PMX、VMD、MindAR、Three.js 和 Ammo WASM 均成功，并校验远端文件哈希。
4. 浏览器验证 PMX 加载、灯光/定位按钮响应；手机现场验证摄像头授权、定位目标首锁、布料与触摸。
5. Android APK 构建命令不变；网页和 APK 的本地存储因 origin 不同而隔离。

## 性能与风险

- 首屏需按浏览器网络速度下载 PMX、纹理和 Three.js，记录资源大小；不宣称和 APK 一样离线。
- WebGL、摄像头权限与真实识别效果取决于手机浏览器及设备；自动资源检查不能替代现场验收。
- 发布只新增目标目录，不触碰 Offline 包、服务 manifest 或现有 APK。

## 预计工时与结果

- 预计 1–2 小时，包括构建路径适配、上传和基础浏览器/HTTPS 验证。
- 已生成约 19 MB / 54 文件的静态资源并上传至指定 HTTPS 路径。浏览器检查 PMX 已加载、`modelReady=true`，页面与资源请求无错误；现场识别效果待测试。
