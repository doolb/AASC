# Android RapidOCR HTTP 测试 APK 实现文档

本文档使用伪代码描述实现，必须与 `android-rapidocr` 实际代码同步。

## 工程和资源

```text
AndroidRapidOcrProject:
    namespace = "com.aasc.rapidocr"
    applicationId = "com.aasc.rapidocr"
    minSdk = 26
    targetSdk = 34
    abi = "arm64-v8a"
    dependency = ONNX Runtime Android
    dependency = OpenCV Android AAR

    requiredAssets = [
        "PP-OCRv6_det_small.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "PP-OCRv6_rec_small.onnx",
        "ppocrv6_dict.txt"
    ]

    buildBundledModelAssets():
        copy requiredAssets from res/models/rapidocr
            to build/generated/assets/rapidocr
        attach generated assets to main source set
```

## 模型文件管理

```text
RapidOcrModelFiles:
    ASSET_DIRECTORY = "rapidocr"
    FILE_NAMES = [detModel, clsModel, recModel, dictionary]

    isComplete(modelDir):
        return modelDir is directory
            and every FILE_NAMES item is a regular file
            and every file has non-zero length

    ensureCopied(assetManager, modelDir):
        if isComplete(modelDir):
            return
        create filesDir/rapidocr as modelDir
        for name in FILE_NAMES:
            source = assetManager.open(ASSET_DIRECTORY + "/" + name)
            temporary = modelDir + "/" + name + ".tmp"
            stream source into temporary
            close source and temporary
            atomically rename temporary to modelDir + "/" + name
        if not isComplete(modelDir):
            throw "RapidOCR 模型文件不完整"
```

## 图片策略

```text
OcrImagePolicy:
    MAX_BODY_BYTES = 20 MiB
    MAX_PIXELS = 12 * 1024 * 1024
    SUPPORTED_CONTENT_TYPES = [image/jpeg, image/png, image/webp]

    validateContentType(contentType):
        normalized = contentType before ';' and lowercase
        if normalized not in SUPPORTED_CONTENT_TYPES:
            throw "Content-Type 必须是 image/jpeg、image/png 或 image/webp"

    decode(bytes):
        reject empty bytes
        bitmap = BitmapFactory.decodeByteArray(bytes)
        reject bitmap == null
        apply EXIF orientation when metadata is available
        reject width * height over MAX_PIXELS
        return bitmap
```

## RapidOCR 推理

```text
RapidOcrEngine.load(modelDir):
    require RapidOcrModelFiles.isComplete(modelDir)
    require OpenCVLoader.initLocal()
    environment = OrtEnvironment.getEnvironment()
    sessionOptions = create CPU session options with 2 intra-op threads and 1 inter-op thread
    detSession = environment.createSession(detModel, sessionOptions)
    clsSession = environment.createSession(clsModel, sessionOptions)
    recSession = environment.createSession(recModel, sessionOptions)
    dictionary = read UTF-8 dictionary lines and append the special space token
    ready = true

RapidOcrEngine.recognize(bitmap):
    require ready
    synchronize inference lock
    startedAt = monotonicClock()
    normalizedImage = resize bitmap so the short side reaches 736 and round dimensions to 32
    normalizedImage = RGB NCHW with (pixel / 255 - 0.5) / 0.5
    probabilityMap = detSession.run(normalizedImage)
    detectedBoxes = DBPostProcessor.extractBoxes(
        probabilityMap,
        threshold = 0.3,
        boxThreshold = 0.5,
        unclipRatio = 1.6,
        dilation = 2x2
    )
    results = []
    for box in detectedBoxes sorted top-to-bottom then left-to-right:
        crop = PerspectiveCropper.crop(bitmap, box)
        direction = clsSession.run([1, 3, 48, 192] padded input)
        if direction.label == "180" and direction.score >= 0.9:
            crop = rotate180(crop)
        recognitionInput = resize and pad crop to [1, 3, 48, 320]
        logits = recSession.run(recognitionInput)
        text, score = CtcDecoder.decode(logits, dictionary)
        if text is not blank:
            append { text, score, box.points } to results
    elapsedMs = monotonicClock() - startedAt
    return { text = join result texts, boxes = results, elapsedMs, image size }

RapidOcrEngine.release():
    close detSession, clsSession, recSession, sessionOptions and environment
    ready = false
```

`DbPostProcessor` 使用 OpenCV 轮廓和旋转矩形计算四点框；置信度在扩张框前计算，
再按 `unclipRatio = 1.6` 以中心点扩张并映射回原图。`CtcDecoder` 的 blank 索引为 0，
相邻重复 token 合并，输出置信度只对最终输出字符求平均。

## HTTP 服务

```text
OcrHttpServer.start(requestedPort):
    if running:
        return existing port
    socket = ServerSocket()
    socket.bind("0.0.0.0", requestedPort)
    running = true
    start accept loop
    return actual port

OcrHttpServer.handle(request):
    request = read headers and Content-Length with 16 KiB header limit
    reject body over 20 MiB
    route = path before query

    if GET route is "/" or "/index.html":
        return OcrWebPage.HTML
    if GET route is "/health":
        return OcrHttpJson.health(engine.ready, running, busy)
    if POST route is "/api/ocr":
        validate image Content-Type first
        if not engine.ready:
            return 503 error
        if recognition lock is occupied:
            return 409 error
        bitmap = OcrImagePolicy.decode(request.body)
        result = submit engine.recognize(bitmap) to one inference worker
            with 60 second timeout
        always recycle bitmap in inference worker finally
        return OcrHttpJson.success(result)
    if method is not GET or POST:
        return 405 error
    return 404 error

OcrHttpServer.stop():
    running = false
    close server socket
    join accept thread with bounded wait
    shutdown client executor
```

## 网页流程

```text
OcrWebPage:
    fileInput accepts image/jpeg, image/png, image/webp
    on file selected:
        create object URL
        show image preview
        clear previous result and box overlay

    on recognize clicked:
        create fetch request to POST /api/ocr
        set Content-Type to selected image MIME
        send selected image bytes
        parse JSON response
        show text, elapsedMs and every score
        draw returned points on an overlay scaled to preview image

    on error:
        show HTTP status and JSON error without throwing away selected image
```

## APK 页面流程

```text
MainActivity.onCreate:
    show model status, HTTP port input default 18080 and start button
    background:
        copy models from assets
        engine.load(modelDir)
        main thread: show model ready and enable start button

on start button:
    validate port in 1024..65535
    background: server.start(port)
    main thread: show http://device-ip:port and switch button to stop

on stop button:
    server.stop()
    clear server reference
    show HTTP stopped

onDestroy:
    mark Activity destroyed
    background: server.stop(); engine.release(); background.shutdown()
```

## 单元测试

```text
RapidOcrModelFilesTest:
    model list contains exactly four required files
    incomplete directory is not ready

OcrImagePolicyTest:
    accepts supported image content types with parameters
    rejects audio and application/octet-stream content types
    rejects empty and undecodable image bytes

OcrHttpJsonTest:
    escapes quote, slash, newline and control characters
    returns boxes, image size and elapsedMs in success JSON

OcrHttpServerTest:
    root endpoint returns embedded page containing /api/ocr and image upload
    health endpoint reports running service and model state
    invalid method and invalid content type return expected status
```
