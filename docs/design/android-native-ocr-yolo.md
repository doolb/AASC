# 正式 Android 显示端 OCR 与 YOLO11n

## 需求等级与边界

这是一次 L7 架构级功能接入：正式 Android 显示端继续负责本地视觉推理，服务器提供统一 HTTP 任务入口和显示端路由。服务器不加载、不执行 OCR/YOLO 模型。

本次接入：

- RapidOCR：检测、方向分类、识别三份 ONNX 模型和字典，共四个资源文件。
- YOLO11n：构建得到的 `yolo11n.onnx`。
- 两个内置一次性任务：`ocr`、`yolo`。
- 服务器 HTTP 路由：`/api/vision/ocr`、`/api/vision/yolo`、`/api/vision/status`。
- 任务参数配置服务器 URL，默认 `http://127.0.0.1:8081`；任务上传图片后调用服务器接口。

本次不接入：

- 服务器侧模型推理。
- `vision-test.html` 手动测试网页。
- APK DevTools。
- YOLO11s/m/l/x 和 ASR/TTS CPU 行为改造。
- YOLO 图片缩放参数；YOLO 继续使用现有预处理。

## 运行架构

```text
控制端任务面板
    ↓ 任务参数 serverUrl + input.* 图片 + targetDisplay
服务器内置 ocr/yolo 任务
    ↓ HTTP POST serverUrl/api/vision/{ocr|yolo}
服务器视觉路由
    ↓ WebSocket visionOcr/visionYolo11n
正式 Android display.html
    ↓ NativeDisplay 异步桥
显示端 VisionRuntime：单线程、单小核、ORT intra/inter=1
    ↓
服务器收到 vision*Result，再返回 HTTP JSON 和任务结果
```

服务器路由只负责接收图片、选择具有对应能力的在线显示端、关联 requestId、等待回传和清理临时文件。指定 `targetDisplay` 时只使用该显示端；未指定时按在线连接顺序选择第一个声明能力的显示端。

## RapidOCR 四个文件

完整 RapidOCR pipeline 不能只用一个 ONNX：

1. `PP-OCRv6_det_small.onnx`：检测文字区域。
2. `ch_ppocr_mobile_v2.0_cls_mobile.onnx`：判断文字方向。
3. `PP-OCRv6_rec_small.onnx`：识别文字内容。
4. `ppocrv6_dict.txt`：CTC 输出索引到汉字/字符的字典。

前三个是不同阶段的模型，字典不是模型但识别解码必需，因此 APK 仍需携带四个文件。

## CPU 策略

视觉能力继续使用 `CpuCluster.detect().policy(bigCoreCount = 0, littleCoreCount = 1)`。视觉执行器只有一个 worker 和一个等待槽，OCR/YOLO 串行；三个 ORT session 或一个 YOLO session 均使用 `intraOpNumThreads=1`、`interOpNumThreads=1`，并在当前 worker 尝试绑定选定小核。

ASR/TTS 的 executor、配置和 CPU policy 不变。affinity 失败时继续推理并在结果中报告回退状态。

## HTTP 与 WebSocket 协议

任务通过服务器 URL 调用：

```text
POST /api/vision/ocr
POST /api/vision/yolo
GET  /api/vision/status
```

POST 同时支持 multipart 字段 `image` 和 JSON 字段 `imageBase64`，可选 `displayId`。服务器返回显示端原生结果，并附加 `displayId`；显示端只接收 WebSocket 图片请求，不直接暴露 HTTP 视觉服务。

```text
server -> display: {
    type: "visionOcr" | "visionYolo11n",
    requestId,
    imageBase64,
    shortSide: 0 | positive integer // 仅 visionOcr，可省略
}

display -> server: {
    type: "visionOcrResult" | "visionYolo11nResult",
    requestId,
    success,
    ...result
}
```

路由超时、显示端离线、能力不匹配、图片非法和视觉运行时异常均返回结构化 HTTP 错误，不把服务器自身误报为视觉推理节点。

## 任务配置

两个内置任务均为 `target=server`、`mode=one-shot`，参数如下：

- `serverUrl`：服务器根地址，默认 `http://127.0.0.1:8081`，支持实例参数覆盖和任务全局配置。
- `targetDisplay`：可选显示端 ID；为空时由服务器按能力自动选择。
- `input.*`：任务图片文件，控制端任务面板选择本地图片后上传保存。
- `shortSide`：仅 OCR 可选的目标短边上限，`0` 表示沿用原有自动行为；控制端预置 `384`、`512`、`736`，也允许 HTTP 调用传入 `256..2048` 的整数。图片短边小于目标值时不放大。

任务执行先将图片编码为 Base64，再请求 `serverUrl` 对应路由；服务器完成显示端本地推理后，任务将完整结果写入任务结果和日志。

## OCR 短边缩放

OCR 任务收到正数 `shortSide` 后，显示端在检测、方向分类和文字识别前按原始宽高比缩小图片；检测到的四边形坐标按实际缩放比例映射回原图，返回结果的 `imageWidth`、`imageHeight` 和文字框坐标仍对应原图。`shortSide=0` 保持现有自动检测尺寸策略。服务器只校验并转发参数，不执行缩放或模型推理。

## 能力声明

正式 `display.html` 继续通过 `NativeDisplay` 方法存在性上报 `ocrAvailable`、`yolo11nAvailable`，并上报模型就绪和视觉 CPU 状态。服务器的执行者摘要和控制端设备列表展示 RapidOCR、YOLO11n 两项只读能力。
