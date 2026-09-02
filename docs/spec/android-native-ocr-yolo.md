# 正式 Android 显示端 OCR 与 YOLO11n 实现规格

## 模型构建伪代码

```text
Gradle prepareBundledVisionModels:
    copy res/models/rapidocr/{det,cls,rec,dict} to generated/assets/vision/rapidocr
    invoke export-yolo11-onnx.py with --models yolo11n
    copy yolo11n.onnx to generated/assets/vision/yolo11
```

## 显示端本地运行时伪代码

```text
VisionCpuPolicy.defaultFor(topology):
    return topology.policy(bigCoreCount = 0, littleCoreCount = 1)

VisionRuntime:
    create one-worker executor with queue capacity 1
    keep RapidOcrEngine and Yolo11nDetector lazy

submit(kind, requestId, imageBase64, callback):
    reject when executor and waiting slot are full
    worker:
        bitmap = decode and validate image
        apply single-little-core affinity
        if kind == OCR:
            atomically copy four RapidOCR assets
            load detector/classifier/recognizer with ORT 1/1
            shortSide = request.shortSide or 0
            workingBitmap = OCR.resizeDownOnly(bitmap, shortSide)
            result = detector(workingBitmap) -> classifier -> recognizer -> dictionary decode
            result.boxes = OCR.mapBoxesToOriginal(result.boxes, workingBitmap, bitmap)
            result.imageWidth/Height = bitmap dimensions
        if kind == YOLO:
            atomically copy yolo11n.onnx
            load one ORT session with ORT 1/1
            result = preprocess -> inference -> confidence/NMS postprocess
        callback(success result with timing and affinity status)
        recycle bitmap in finally
```

## 显示端 WebSocket 伪代码

```text
on display websocket message:
    if type == "visionOcr":
        if shortSide > 0:
            accepted = NativeDisplay.ocrRecognizeScaledAsync(requestId, imageBase64, shortSide)
        else:
            accepted = NativeDisplay.ocrRecognizeAsync(requestId, imageBase64)
        if accepted is false:
            send visionOcrResult(requestId, success=false, error)
    if type == "visionYolo11n":
        accepted = NativeDisplay.yolo11nDetectAsync(requestId, imageBase64)
        if accepted is false:
            send visionYolo11nResult(requestId, success=false, error)

window.onNativeOcrResult(result):
    send visionOcrResult with result.requestId

window.onNativeYoloResult(result):
    send visionYolo11nResult with result.requestId
```

## 服务器视觉路由伪代码

```text
POST /api/vision/{kind}:
    read multipart image or JSON imageBase64
    validate kind in {ocr, yolo}
    if kind == ocr:
        validate optional shortSide as 0 or integer in 256..2048
    resolve optional displayId
    display = find online display with capability kindAvailable
    if display missing:
        return 503
    requestId = unique vision request ID
    pendingVisionRequests[requestId] = {displayId, resolve, reject, timeout}
    sendToDisplay(displayId, {
        type: kind == ocr ? "visionOcr" : "visionYolo11n",
        requestId,
        imageBase64,
        if kind == ocr and shortSide is provided: shortSide
    })
    await matching vision*Result or timeout
    cleanup pending request and temporary upload
    return result with displayId

GET /api/vision/status:
    return route paths and each display's ocr/yolo capability, CPU status and online state
```

## 内置任务伪代码

```text
registry:
    register "ocr" -> OcrTask
    register "yolo" -> YoloTask

VisionTask.run(context, kind):
    globalConfig = taskIO.getTaskConfig(taskName)
    serverUrl = params.serverUrl or globalConfig.serverUrl or "http://127.0.0.1:8081"
    image = context.files[params.imageFileName] or first input image
    displayId = params.targetDisplay or null
    request = { imageBase64, displayId }
    if kind == ocr: request.shortSide = params.shortSide or 0
    response = POST serverUrl + "/api/vision/" + kind with request
    if HTTP or response status is error:
        throw structured task error
    return {success: true, data: response}
```

## 任务面板伪代码

```text
when builtinId is "ocr" or "yolo":
    render serverUrl input defaulting to http://127.0.0.1:8081
    render local image file picker and online display selector
    if builtinId == "ocr": render shortSide select {0, 736, 512, 384}
    on submit:
        read selected file as Base64
        submit builtin task target=server with params and input.* file
```

## 测试伪代码

```text
assert registry contains ocr and yolo with serverUrl/server targetDisplay parameters
assert task client uses default http://127.0.0.1:8081 and sends input image to matching endpoint
assert OCR task forwards shortSide and YOLO task does not expose or send shortSide
assert HTTP route rejects missing image, unavailable display and invalid kind
assert matching vision request resolves only the same requestId and displayId
assert display page handles vision request/result message types and native bridge callbacks
assert display capability list includes RapidOCR and YOLO11n read-only statuses
assert formal Android JVM tests cover single-little-core, image limits, model files, OCR and YOLO postprocess
assert no vision-test page or DevTools hook remains
assert OCR shortSide coordinate mapping keeps returned boxes in original image dimensions
assert existing ASR/TTS tests remain green
```
