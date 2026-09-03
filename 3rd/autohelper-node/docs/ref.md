# 外部资源参考

- 原始参考项目：`/mnt/tmp/autohelper`
- AASC OCR CLI：`/mnt/AASC/scripts/api/vision-ocr.js`，请求 `POST /api/vision/ocr`。
- AASC OCR 服务实现：`/mnt/AASC/src/apps/server/boot/server-app.js`，返回 `boxes`、图片尺寸和请求状态。
- AASC OCR 结果展示：`/mnt/AASC/scripts/api/vision-tui.js`，文字框使用 `text`、`score` 和 `points` 字段。
- ADB：Android Debug Bridge 命令行工具
- OpenCV.js：`@techstark/opencv-js` 预编译 WASM，提供模板匹配和 ORB 特征匹配
- Node.js：`child_process`、`fs/promises`、`path`、`util.parseArgs`
- 测试：Vitest

图片解码使用 `pngjs` 和 `bmp-js`，依赖安装不需要系统 OpenCV、`node-gyp` 或 C++ 编译器。
