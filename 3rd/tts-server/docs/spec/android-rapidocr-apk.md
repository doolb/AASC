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
        create modelDir
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
    environment = OrtEnvironment.getEnvironment()
    sessionOptions = create CPU session options
    detSession = environment.createSession(detModel, sessionOptions)
    clsSession = environment.createSession(clsModel, sessionOptions)
    recSession = environment.createSession(recModel, sessionOptions)
    dictionary = read UTF-8 dictionary lines
    ready = true

RapidOcrEngine.recognize(bitmap):
    require ready
    synchronize inference lock
    startedAt = monotonicClock()
    normalizedImage = resize and normalize bitmap using RapidOCR det defaults
    probabilityMap = detSession.run(normalizedImage)
    detectedBoxes = DBPostProcessor.extractBoxes(
        probabilityMap,
        threshold = 0.3,
        boxThreshold = 0.5,
        unclipRatio = 1.6
    )
    results = []
    for box in detectedBoxes sorted top-to-bottom then left-to-right:
        crop = PerspectiveCropper.crop(bitmap, box)
        direction = clsSession.run(ClassifierPreprocessor.toInput(crop))
        if direction.label == "180" and direction.score >= 0.9:
            crop = rotate180(crop)
        recognitionInput = RecognitionPreprocessor.toInput(crop, height = 48, maxWidth = 320)
        logits = recSession.run(recognitionInput)
        text, score = CtcDecoder.decode(logits, dictionary)
        if text is not blank:
            append { text, score, box.points } to results
    elapsedMs = monotonicClock() - startedAt
    return { text = join result texts, boxes = results, elapsedMs, image size }

RapidOcrEngine.release():
    close detSession, clsSession, recSession and sessionOptions
    ready = false
```

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
        if not engine.ready:
            return 503 error
        if recognition lock is occupied:
            return 409 error
        validate image Content-Type
        bitmap = OcrImagePolicy.decode(request.body)
        result = engine.recognize(bitmap) with 60 second timeout
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
    server.stop()
    engine.release()
    background.shutdownNow()
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
