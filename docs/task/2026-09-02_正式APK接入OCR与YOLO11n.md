# 正式 APK 接入 OCR/YOLO 任务与显示端本地推理

## 任务描述

正式 Android 显示 APK 内置 RapidOCR 与 YOLO11n 本地推理；新增服务器 HTTP 视觉路由和两个一次性内置任务。任务配置服务器 URL，默认本机地址，通过服务器接口调用；服务器只负责路由，显示端执行实际推理。

## 需求分级

- 等级：L7 架构级功能接入。
- 状态：已完成。
- 关键约束：不在服务器加载视觉模型；不增加 APK DevTools；不保留 `vision-test.html`。

## Design 需求

- RapidOCR 四个资源文件和 YOLO11n ONNX 继续打包进正式 APK。
- 视觉推理默认 `0` 个大核、`1` 个小核，ORT intra/inter 均为 1。
- 新增 `/api/vision/ocr`、`/api/vision/yolo`、`/api/vision/status`。
- 新增 `ocr`、`yolo` 内置一次性任务，配置 `serverUrl`，默认 `http://127.0.0.1:8081`。
- 任务上传的图片经过服务器路由，通过 WebSocket 发给显示端 NativeBridge 本地推理。
- 控制端设备列表显示 OCR/YOLO 能力，能力项只读。

## Spec 设计

- 服务器维护 requestId 到显示端的待回传表和超时清理。
- `display.html` 接收 `visionOcr`/`visionYolo11n`，调用本地异步桥并回传结果。
- 内置任务读取 `input.*` 图片，向配置的服务器 URL POST Base64 JSON。
- 任务面板提供服务器 URL、目标显示端和本地图片选择。
- 旧视觉测试网页和 Debug DevTools 支持删除。

## 受影响的功能模块与代码

- Android 正式 APK：视觉运行时、NativeBridge、display.html 能力和 WebSocket 消息。
- 服务端：视觉路由、显示端 requestId 转发、能力状态和临时图片清理。
- 任务引擎：`ocr`、`yolo` 内置任务、注册表和任务面板配置表单。
- 文档：design/spec/usage/task/todo/changelog。

## 自测用例

1. 内置任务列表出现 OCR 和 YOLO 两个任务，默认服务器 URL 为 `http://127.0.0.1:8081`。
2. 通过任务面板上传 `/mnt/tmp` 下游戏截图，任务能调用对应 HTTP 路由。
3. 没有对应显示端能力时路由返回 503；显示端离线或超时返回结构化错误。
4. 显示端收到请求后调用本地 NativeBridge，结果按同一 requestId 返回。
5. OCR 与 YOLO 串行使用单个小核，结果记录耗时、CPU affinity 和模型状态。
6. 能力列表显示 RapidOCR、YOLO11n；普通旧 APK 不误报这两个能力。

## 兼容性测试

- Android 9 arm64-v8a 测试设备 `192.168.1.6:5555`。
- minSdk 26、targetSdk 34。
- 旧显示端不支持视觉消息时，其他显示、ASR、TTS 功能保持不变。
- 普通浏览器只作为控制端任务面板，不执行 NativeDisplay 本地视觉。

## 性能测试

- 使用 `/mnt/tmp` 现有游戏截图测试 OCR/YOLO 首次和后续耗时。
- 记录显示端本地推理耗时、总 HTTP 往返耗时、选中 CPU 和 affinity 状态。
- 连续提交请求确认视觉队列有界、OCR/YOLO 不并发争抢内存。

## 风险评估

- 服务器 URL 配置错误：任务返回 URL/HTTP 状态错误并写入任务日志。
- 无视觉显示端：路由返回 503，不回退为服务器推理。
- 显示端 WebSocket 断开：清理 pending request 并返回失败。
- 图片过大或格式异常：服务器和显示端分别限制，避免无界内存分配。
- RapidOCR 四文件缺失：APK 构建和显示端复制阶段完整性校验失败。

## 预计工时

- 文档与契约测试：0.5 小时。
- 服务端路由与任务：2 小时。
- 显示端消息接入与任务面板：1 小时。
- 真机截图验证、回归和提交：1.5 小时。

## 执行结果

- 服务器 `/api/vision/status` 确认 `serverInference=false`；显示端 `display-umwo5k6l` 声明 `ocrAvailable=true`、`yolo11nAvailable=true`，另一旧显示端未声明视觉能力。
- `npm run build:apk`：`BUILD SUCCESSFUL`；APK 包含 RapidOCR 四个资源和 `vision/yolo11/yolo11n.onnx`。
- `./src/apps/android-display/gradlew -p src/apps/android-display :app:testDebugUnitTest --no-daemon --console=plain`：`BUILD SUCCESSFUL`。
- `python3 -m unittest 3rd/tts-server/scripts/test_export_yolo11_onnx.py -v`：3/3 通过。
- `node --check` 服务端、任务模块、任务面板通过；视觉 Node 契约测试 7/7 通过；`git diff --check` 通过。
- HTTP 路由实测：无图片 JSON 请求返回 `400` 结构化错误；multipart `POST /api/vision/yolo` 返回 `status=success`，并带显示端 ID、推理耗时、检测结果和单小核状态。
- Android 9 arm64 真机 `192.168.1.6:5555` 安装 APK 后，通过内置 `ocr`/`yolo` 任务模块调用默认本机服务器 URL，服务器再通过 WebSocket 调度到 `display-umwo5k6l`。使用 `/mnt/tmp` 中现有 16 张 `infinity_nikki_*.png`，两种任务均 16/16 成功，全部结果为“单小核（核心 0）”。

### `/mnt/tmp` 现有游戏截图测试记录

| 图片 | OCR耗时/框数 | YOLO推理耗时/检测数 |
|---|---:|---:|
| `infinity_nikki_after_ad.png` | 44,487ms / 36 | 1,721ms / 0 |
| `infinity_nikki_after_connect_wait.png` | 44,096ms / 36 | 1,704ms / 0 |
| `infinity_nikki_after_launch.png` | 21,829ms / 4 | 1,714ms / 0 |
| `infinity_nikki_current.png` | 48,404ms / 41 | 1,727ms / 0 |
| `infinity_nikki_enter_retry.png` | 43,539ms / 35 | 1,740ms / 0 |
| `infinity_nikki_game_entry.png` | 39,268ms / 29 | 1,724ms / 1 |
| `infinity_nikki_loaded.png` | 27,457ms / 12 | 1,753ms / 2 |
| `infinity_nikki_loading_check.png` | 45,660ms / 37 | 1,763ms / 0 |
| `infinity_nikki_main.png` | 43,585ms / 35 | 1,747ms / 1 |
| `infinity_nikki_playable.png` | 26,475ms / 11 | 1,727ms / 2 |
| `infinity_nikki_ready.png` | 30,877ms / 17 | 1,713ms / 1 |
| `infinity_nikki_region_test.png` | 34,925ms / 23 | 1,698ms / 0 |
| `infinity_nikki_session_start.png` | 40,748ms / 30 | 1,759ms / 1 |
| `infinity_nikki_skip_benefit.png` | 46,860ms / 40 | 1,736ms / 0 |
| `infinity_nikki_start_check2.png` | 43,408ms / 35 | 1,714ms / 0 |
| `infinity_nikki_title_entered.png` | 23,123ms / 6 | 1,711ms / 0 |
| **平均** | **37,796ms / 26.7** | **1,728ms / 0.5** |

准确性结论：对 `infinity_nikki_main.png` 的主要中文 UI 文本，OCR 输出与画面内容基本对应；画面顶部状态栏、小字号和截断文字会产生噪声或误识别。本次 YOLO11n 使用通用 COCO 权重，检测框数量不等同于业务准确率；由于没有游戏目标标注集，只记录定性结果，不宣称 Precision、Recall 或 mAP。
