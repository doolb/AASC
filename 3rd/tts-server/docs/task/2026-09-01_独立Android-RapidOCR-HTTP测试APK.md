# 独立 Android RapidOCR HTTP 测试 APK

## 任务描述

参考 `android-tts` 和 `android-asr` 测试 APK，在 `3rd/tts-server` 下新增独立 RapidOCR Android 测试 APK。APK 本地加载 RapidOCR ONNX 模型并启动 HTTP 服务，外部可以通过接口上传图片；HTTP 根路径同时提供网页，用户可以手动选择图片并测试 OCR。

## Design 需求

- 新增 `3rd/tts-server/android-rapidocr/` 独立 Kotlin/Gradle 工程。
- 使用 ONNX Runtime Android + OpenCV Android AAR 执行 RapidOCR 检测、方向分类和识别。
- 内置 PP-OCRv6 small 检测/识别模型、PP-OCRv4 mobile 方向分类模型和 PP-OCRv6 字典。
- APK 原生页面只负责模型状态和 HTTP 服务端口的启动/停止。
- 默认绑定 `0.0.0.0:18080`，提供 `GET /`、`GET /health`、`POST /api/ocr`。
- 根路径网页支持手动上传 JPG、PNG、WebP 图片，显示原图、识别文本、置信度、耗时和文字框。
- 不依赖 AASC 主服务器，不访问外网，仅支持 `arm64-v8a`、Android 8.0+。

## Spec 设计

- `RapidOcrModelFiles` 管理四个模型/字典文件的 assets 打包、私有目录复制和完整性校验。
- `OcrImagePolicy` 负责 Content-Type、请求体大小、图片解码、像素上限和 EXIF 方向处理。
- `RapidOcrEngine` 负责 ONNX Runtime session、DB 检测后处理、方向分类、透视裁剪、CTC 解码和资源释放。
- `OcrHttpServer` 负责本地 HTTP 监听、根网页、health、OCR 请求、超时、忙状态和统一错误返回。
- `OcrWebPage` 负责浏览器图片上传、预览、结果展示和文字框坐标叠加。
- `MainActivity` 负责模型加载状态、端口校验和服务生命周期。

## 受影响的功能模块和代码

### 新增代码

- `3rd/tts-server/android-rapidocr/` Android 工程和模型资源。
- `res/models/rapidocr/` RapidOCR ONNX 模型及字典。

### 修改代码和文档

- `3rd/tts-server/package.json` 增加 `build:android-rapidocr`。
- `3rd/tts-server/docs/design/android-rapidocr-apk.md`。
- `3rd/tts-server/docs/spec/android-rapidocr-apk.md`。
- `3rd/tts-server/docs/design.md`、`docs/spec.md`、`docs/todo.md`、`changelog.md` 索引和记录。
- 根目录对应 design/spec/task/todo/changelog 索引和记录。

## 自测用例

1. 模型文件全部存在时可以完成 assets 复制和 session 初始化。
2. 模型文件缺失或复制中断时，APK 显示模型未就绪，不启动 HTTP OCR 请求。
3. 网页选择 JPG、PNG、WebP 后可以上传并显示结果。
4. `curl` 上传原始图片到 `/api/ocr` 返回 `success`、`text`、`elapsedMs` 和 `boxes`。
5. 空请求、错误 Content-Type、空图片、超大图片返回 400/415，不进入模型推理。
6. 模型未加载返回 503，重复并发识别返回 409，超时返回 504。
7. `/health` 正确反映模型、HTTP 服务和忙状态。
8. Activity 退出后关闭 ServerSocket、客户端线程池、ONNX session 和图片资源。

## 兼容性测试

- Android 8.0、9、10、12、14 的 arm64 设备。
- JPG、PNG、WebP 图片；带 EXIF 旋转信息的手机照片。
- Chrome、Edge 和 Android WebView 访问内置网页。
- 非 arm64 设备只在安装/构建说明中明确不支持。

## 性能测试

- 记录模型首次加载耗时和 APK 内存占用。
- 使用 720p、1080p 和长图分别连续识别 10 次，记录每次 `elapsedMs`、平均值和 P95。
- 验证同一时间多个 HTTP 请求只有一个进入推理，其余请求快速返回 409。
- 验证重复请求后 Bitmap、Mat、ONNX tensor 和 HTTP worker 没有持续累积。

## 风险评估

- RapidOCR 模型输出和预处理参数强相关，必须用固定模型进行 arm64 真机识别验证。
- OpenCV/ONNX Runtime native 库可能显著增加 APK 体积，首版不做库裁剪。
- HTTP 服务无鉴权并绑定所有网卡，只允许受信任局域网使用。
- 模型、第三方库和字典的许可证需要在 APK 文档中保留来源说明。

## 预计工时

约 6 小时：模型资源和工程配置 1 小时，OCR 预处理/后处理 2.5 小时，HTTP 服务和网页 1 小时，测试与文档 1.5 小时。

## 执行记录

- ✅ [2026-09-01] 已完成独立 RapidOCR HTTP 测试 APK。
  - 模型资源：`res/models/rapidocr/` 下 PP-OCRv6 det/rec、PP-OCRv4 cls 和 `ppocrv6_dict.txt`，构建时复制到 APK assets。
  - HTTP：`GET /`、`GET /health`、`POST /api/ocr`，默认 `0.0.0.0:18080`，支持 JPG/PNG/WebP 原始二进制上传。
  - 网页：内置单文件 HTML，支持手动选图、预览、ArrayBuffer 上传、结果/耗时/置信度和文字框 canvas 叠加。
  - 验证：模块 JVM 单元测试通过；debug APK 构建、arm64 真机安装、模型加载、health、网页接口和真实图片 OCR 请求通过。
  - 真实图片示例：`RapidOCR HTTP Test 123` 返回 `RapidOCR HT`、`CR HTTP Test 12`、`t 123` 三个文字框；设备端未执行多系统版本和连续 P95 压测。
