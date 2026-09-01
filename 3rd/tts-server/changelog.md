# 变更日志

### Android RapidOCR 测试 APK

- ✅ [2026-09-01] 新增独立 Android RapidOCR HTTP 测试 APK。
  - 改动文件：`android-rapidocr/` 工程、`res/models/rapidocr/` 四个固定模型资源、`package.json` 构建脚本、RapidOCR design/spec/task 文档和 readme。
  - 功能：ONNX Runtime + OpenCV 离线检测/方向分类/识别，提供 `GET /`、`GET /health`、`POST /api/ocr`，网页支持手动上传 JPG/PNG/WebP 并绘制文字框。
  - 验证结果：模块 JVM 单元测试通过；debug APK 构建和 arm64 真机安装通过；真机模型加载、health、网页页面、PNG curl 上传和真实文字 OCR 通过。

## 2026-08-29

- 删除：测试 APK 普通 ASR、声纹测试及正式 Display APK 不再支持“过滤其他文字”和 `zh-en-filter`，识别结果不再按 Unicode 脚本删除字符。
- 保留：`auto`、`zh`、`en` 语言提示、降噪、快速多段和固定双语流式 ASR。
- 测试：测试 APK JVM 单测和正式 Display APK Debug 构建通过。

- 调整：测试 ASR 普通非流式识别和声纹网页测试固定使用中文 `zh`，移除网页语言选择；流式中英双语 Zipformer 保持不变。
- 测试：网页语言契约 4/4、Android JVM 单元测试、debug APK 构建和真机安装通过。

- 新增：测试 ASR APK Android 原生界面和内置网页增加“保存当前 WAV”按钮。
- 兼容：Android 10 及以上保存到系统 Download，Android 8/9 保存到 APK 专属外部音频目录，不增加旧版存储权限。
- 统一：保存文件使用 16kHz、单声道、16-bit PCM WAV；网页保持 `.wav` 文件名下载。
- 测试：网页静态契约 3/3、Android JVM 单元测试和 debug APK 构建通过。

## 2026-08-25

- 新增：`android-asr/` 独立 Android 离线语音识别 APK，内置 SenseVoice int8 模型，支持录音、音频选择和识别耗时显示。
- 新增：APK 的 `0.0.0.0:18080` 根路径提供普通网页，支持 WAV 选择、网页录音和识别结果显示；页面内部使用 `/health`、`/api/asr`。
- 构建：增加 `npm run build:android-asr`，APK 包含 `arm64-v8a` affinity 库、`model.int8.onnx` 和 `tokens.txt`。
- 测试：Android JVM 测试、静态接口测试、debug APK 构建、模型资源检查和 adb 安装通过。

- 新增：独立 Android TTS APK 增加“自动/大核/小核”CPU 模式选择，默认自动并持久化。
- 新增：通过 JNI 动态识别 CPU capacity/最大频率并绑定 TTS 工作线程；无法识别或绑定失败时自动回退系统调度。
- 新增：模型加载和每次合成前应用 CPU 模式，状态栏显示实际核心集合或回退原因。
- 测试：CMake/NDK 生成并打包 `arm64-v8a` CPU affinity 库，完整 Android JVM 测试和 debug APK 构建通过。

- 新增：`android-tts/` 独立 Android 离线 TTS APK，内置 Xiaoxiao 模型，不申请网络权限。
- 新增：APK 提供多行文本框和生成按钮，使用 `SpeechSynthesizer(config, null)` 只生成 WAV 数据，再由 `MediaPlayer` 播放。
- 新增：生成完成后显示 SDK 合成阶段耗时，格式为“生成完成，用时 X.XX 秒”；模型加载和播放时间不计入该耗时。
- 构建：增加 `npm run build:android-tts`，模型从 `models/extracted` 构建复制，限定 `arm64-v8a` 和 Android 8.0+。
- 测试：Android JVM 单元测试和 debug APK 构建通过，APK 资源包含 14 个模型文件，Manifest 不包含 `INTERNET` 权限。

## 2026-08-25

- 新增：`tts-linux.js` 及 `linux/` 独立构建入口，提供 Linux Embedded Speech TTS HTTP 服务。
- 兼容：接口与 `tts-wine.js` 保持一致，支持 FIFO 队列、队列上限、单并发、超时、临时文件清理和状态查询。
- 解耦：默认运行时路径不再依赖 `NaturalVoiceSAPIAdapter`；CMake 使用可迁移的 `$ORIGIN/../lib` 运行库路径。
- 测试：Linux TTS HTTP/队列回归 5 项通过，CLI CMake 编译通过；真实合成受当前主机 AVX 指令集限制，记录为环境限制。
- 迁移：Linux Embedded SDK 目标为 `linux/sdk`，Wine 编译 SDK 目标为 `wine/runtime/sdk-win41`，Wine prefix 目标为 `wine/runtime/prefix`；旧 NaturalVoice 源目录暂保留。
- 统一：Linux/Wine/APK 使用同一硬编码授权串；Linux 服务忽略 `TTS_LINUX_LICENSE/MS_TTS_KEY` 外部授权覆盖。
- 构建：Linux CMake 提供 `cmake --install`，生成 `bin` + `lib` 可迁移运行时布局。
- 自动化：新增 `scripts/prepare-runtime.sh`，下载 Microsoft SDK、生成 Wine prefix、编译并测试 Linux/Wine TTS。
- Wine 运行时：准备脚本支持 `WINE_BIN_DIR`，部署本次下载的 x64 DLL 后再执行测试。
- SDK 归档：Linux SDK tar.gz 与四个 Wine nupkg 保存在 `sdk-archives`，补充 `SHA256SUMS`，使用普通 Git 提交，不使用 Git LFS；构建结束不删除原始压缩包。
- 删除旧适配器：独立 Linux/Wine 运行时迁移完成，`3rd/NaturalVoiceSAPIAdapter` 不再是服务构建或运行依赖。

- 修复：`tts-wine.js` 将队列任务绑定到 `drain()` 已预留的 Wine worker，恢复 `/api/tts` 与 `/api/voices` 正常请求。
- 优化：参考 `tts.js` 增加 FIFO 队列的断连清理、排队超时、队列上限和状态字段。
- 测试：固定 100 字文本集成、并发队列、断连恢复和 100 次 HTTP 压测全部完成；发现 RSS 从约 270MB 增长到约 430MB，保留为后续 SDK 句柄专项风险。

## 2026-04-17

- 修复：`/api/tts` 在生成失败、参数校验失败时统一返回 JSON 错误结构，便于调用方识别失败原因。
- 优化：`/api/voices` 失败返回结构统一为 `success: false`，减少前后端错误处理分支差异。
