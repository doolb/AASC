# Android 显示端 OCR/YOLO 任务使用说明

正式 Android 显示端内置 RapidOCR 和 YOLO11n，实际推理在显示端本地完成，默认使用一个小核。服务器只提供统一 HTTP 路由和显示端调度。

## 使用方式

1. 打开控制端 `/upload`，进入任务面板。
2. 创建内置任务 **OCR 文字识别** 或 **YOLO 目标检测**。
3. `serverUrl` 默认填写 `http://127.0.0.1:8081`；控制端和服务器不在同一进程时，改成服务器可访问地址。
4. 选择目标显示端；不指定时服务器自动选择声明对应视觉能力的在线显示端。
5. 选择图片文件并提交任务。可以直接选择 `/mnt/tmp/` 下已有的游戏截图。

## HTTP 接口

```text
POST http://<服务器地址>:8081/api/vision/ocr
POST http://<服务器地址>:8081/api/vision/yolo
GET  http://<服务器地址>:8081/api/vision/status
```

POST 支持 multipart 的 `image` 文件，也支持 JSON 的 `imageBase64` 和可选 `displayId`。接口返回显示端本地推理结果、耗时、CPU affinity 和实际使用的显示端 ID。

## RapidOCR 为什么需要四个文件

- 检测模型：找到文字框。
- 方向分类模型：判断文字是否需要旋转。
- 识别模型：把文字框转换成字符概率。
- 字典：把识别模型输出索引解码为文字。

四个文件共同组成完整流水线，缺少任意一个阶段都不能得到可靠文字结果。
