# Android YOLO11 五模型测速 APK 实现文档

本文档使用伪代码描述实现，必须与 `android-yolo` 实际代码同步。

## 工程和构建资源

```text
AndroidYoloProject:
    namespace = "com.aasc.yolo"
    applicationId = "com.aasc.yolo"
    minSdk = 26
    targetSdk = 34
    abi = "arm64-v8a"
    dependency = ONNX Runtime Android 1.22.0

    modelNames = ["yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x"]
    inputModelDirectory = environment["YOLO11_MODEL_DIR"] or "/home/as"
    outputAssetDirectory = build/generated/assets/yolo11

    prepareBundledYoloModels():
        for modelName in modelNames:
            source = inputModelDirectory + "/" + modelName + ".pt"
            target = outputAssetDirectory + "/" + modelName + ".onnx"
            if source is missing:
                throw "缺少 YOLO11 权重: " + source
            if target is missing or source newer than target:
                run python export-yolo11-onnx.py(
                    "--input-dir", inputModelDirectory,
                    "--output-dir", outputAssetDirectory
                )
            require target is regular file and target.length > 0
        attach outputAssetDirectory to main assets
```

## 模型文件管理

```text
YoloModel:
    N = ("yolo11n", "YOLO11n", 0)
    S = ("yolo11s", "YOLO11s", 1)
    M = ("yolo11m", "YOLO11m", 2)
    L = ("yolo11l", "YOLO11l", 3)
    X = ("yolo11x", "YOLO11x", 4)

YoloModelFiles:
    ASSET_DIRECTORY = "yolo11"
    FILE_NAMES = ["yolo11n.onnx", "yolo11s.onnx", "yolo11m.onnx", "yolo11l.onnx", "yolo11x.onnx"]

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
            throw "YOLO11 模型文件不完整"
```

## 图片和预处理

```text
YoloImagePolicy:
    MAX_BODY_BYTES = 20 MiB
    MAX_PIXELS = 12 * 1024 * 1024
    SUPPORTED_CONTENT_TYPES = [image/jpeg, image/png, image/webp]

    validateContentType(contentType):
        normalized = contentType before ';' and lowercase
        if normalized not in SUPPORTED_CONTENT_TYPES:
            throw "Content-Type 必须是 image/jpeg、image/png 或 image/webp"

    decode(bytes):
        reject empty bytes
        bounds = BitmapFactory.decodeByteArray(bytes, inJustDecodeBounds = true)
        reject bounds.width <= 0 or bounds.height <= 0
        reject bounds.width * bounds.height > MAX_PIXELS
        bitmap = BitmapFactory.decodeByteArray(bytes)
        reject bitmap == null
        validate bitmap.width * bitmap.height <= MAX_PIXELS again
        return bitmap

YoloPreprocessor.prepare(bitmap):
    scale = min(640 / bitmap.width, 640 / bitmap.height)
    resizedWidth = round(bitmap.width * scale)
    resizedHeight = round(bitmap.height * scale)
    padLeft = (640 - resizedWidth) / 2
    padTop = (640 - resizedHeight) / 2
    canvas = gray 640x640 bitmap
    draw bitmap into canvas at (padLeft, padTop) with resized size
    pixels = canvas.getPixels()
    input = FloatArray(1 * 3 * 640 * 640)
    for y in 0 until 640:
        for x in 0 until 640:
            pixel = pixels[y * 640 + x]
            input[red(y,x)] = red(pixel) / 255.0
            input[green(y,x)] = green(pixel) / 255.0
            input[blue(y,x)] = blue(pixel) / 255.0
    return PreparedInput(input, scale, padLeft, padTop, bitmap.width, bitmap.height)
```

## YOLO11 输出解析和 NMS

```text
YoloPostprocessor.decode(shape, values, preparedInput, confidenceThreshold, iouThreshold):
    require shape has batch dimension 1
    if shape is [1, featureCount, candidateCount]:
        featureAt(feature, candidate) = values[feature * candidateCount + candidate]
    else if shape is [1, candidateCount, featureCount]:
        featureAt(feature, candidate) = values[candidate * featureCount + feature]
    else:
        throw "不支持的 YOLO11 输出形状"

    classCount = featureCount - 4
    candidates = []
    for candidate in 0 until candidateCount:
        classScores = feature 4..featureCount
        score = max(classScores values clamped to 0..1)
        # export-yolo11-onnx.py 使用 Ultralytics 检测导出，类别分量已经 sigmoid；不按负值逐项再次 sigmoid。
        if score < confidenceThreshold:
            continue
        centerX = featureAt(0, candidate)
        centerY = featureAt(1, candidate)
        width = featureAt(2, candidate)
        height = featureAt(3, candidate)
        left = (centerX - width / 2 - preparedInput.padLeft) / preparedInput.scale
        top = (centerY - height / 2 - preparedInput.padTop) / preparedInput.scale
        right = (centerX + width / 2 - preparedInput.padLeft) / preparedInput.scale
        bottom = (centerY + height / 2 - preparedInput.padTop) / preparedInput.scale
        append clamped Detection(classId, score, left, top, right, bottom)

    selected = classAwareNonMaximumSuppression(candidates, iouThreshold)
    return selected sorted by score descending and limited to 100
```

## 单模型推理和测速

```text
YoloDetector.load(model):
    if activeModel == model and activeSession != null:
        return loadTimeMs = 0
    close activeSession and activeSessionOptions
    start = monotonicClock()
    sessionOptions = create CPU ONNX Runtime options
    activeSession = environment.createSession(filesDir/yolo11/model.fileName, sessionOptions)
    activeModel = model
    return loadTimeMs = monotonicClock() - start

YoloDetector.detect(bitmap, model, cpuMode):
    acquire detector.inferenceLock
    synchronize detector state:
        loadTimeMs = load(model)
        affinityStatus = CpuAffinity.apply(cpuMode)
        preprocessStarted = monotonicClock()
        prepared = YoloPreprocessor.prepare(bitmap)
        preprocessMs = monotonicClock() - preprocessStarted
        inferenceStarted = monotonicClock()
        output = activeSession.run(OnnxTensor(prepared.input, [1,3,640,640]))
        inferenceMs = monotonicClock() - inferenceStarted
        postprocessStarted = monotonicClock()
        detections = YoloPostprocessor.decode(output.shape, output.values, prepared, 0.25, 0.45)
        postprocessMs = monotonicClock() - postprocessStarted
        result = YoloResult(model, detections, Timing(loadModel=loadTimeMs, preprocess=preprocessMs,
            inference=inferenceMs, postprocess=postprocessMs,
            total=preprocessMs + inferenceMs + postprocessMs), affinityStatus)
    release detector.inferenceLock
    return result

YoloBenchmark.run(bitmap, models, warmupCount, runCount, cpuMode):
    acquire detector.inferenceLock for the complete benchmark
    for model in models in fixed N,S,M,L,X order:
        loadTimeMs = detector.load(model)
        repeat warmupCount times:
            detector.detectLoaded(bitmap, cpuMode)
        samples = repeat runCount times:
            detector.detectLoaded(bitmap, cpuMode).timing
        append BenchmarkItem(model, loadTimeMs, average(preprocess), average(inference),
            average(postprocess), average(total), percentile(total, 50),
            percentile(total, 95), 1000 / average(total), samples.last.detectionCount)
    release detector.inferenceLock
    return BenchmarkResult(warmupCount, runCount, items)

YoloDetector.close():
    acquire detector.inferenceLock
    synchronize detector state:
        release active session and session options
        close ORT environment
    release detector.inferenceLock
```

## HTTP 服务

```text
YoloHttpServer.handle(request):
    parse request line, headers and Content-Length
    decode query parameters with URLDecoder.decode(value, "UTF-8") for Android API 26 compatibility
    reject Transfer-Encoding and body > 20 MiB
    route = path before '?'
    query = parse query values

    if GET route is "/" or "/index.html":
        return YoloWebPage.HTML
    if GET route is "/health":
        return YoloHttpJson.health(engine.isReady, running, busy, engine.activeModel)
    if GET route is "/api/models":
        return YoloHttpJson.models(engine.models(), engine.activeModel)
    if POST route is "/api/yolo":
        validate image content type
        model = parse optional query model or engine.activeModel or YoloModel.N
        acquire busy flag or return 409
        bitmap = YoloImagePolicy.decode(request.body)
        result = inferenceExecutor.submit {
            detector.detect(bitmap, model, cpuModeProvider())
        }.get(60 seconds)
        recycle bitmap in finally
        return YoloHttpJson.success(result)
    if POST route is "/api/benchmark":
        validate image content type
        models = parse all or comma-separated model names
        warmup = parse integer and require 0..10
        runs = parse integer and require 1..50
        acquire busy flag or return 409
        bitmap = YoloImagePolicy.decode(request.body)
        result = inferenceExecutor.submit {
            benchmark.run(bitmap, models, warmup, runs, cpuModeProvider())
        }.get(900 seconds)
        recycle bitmap in finally
        return YoloHttpJson.success(result)
    if method is not GET or POST:
        return 405 error
    return 404 error
```

## 网页流程

```text
YoloWebPage:
    on page load:
        GET /api/models
        fill model selector

    on image selected:
        create object URL
        show preview
        clear old boxes and result

    on detect clicked:
        POST selected image to /api/yolo?model=selectedModel
        show detection count, stage timings and JSON details
        draw each returned box on canvas scaled to preview image

    on benchmark clicked:
        POST selected image to /api/benchmark?models=all&warmup=2&runs=10
        render one row per model with load, average, P50, P95 and FPS

    on error:
        show HTTP status and JSON error while preserving selected image
```

## 单元测试

```text
YoloModelFilesTest:
    model list contains exactly N,S,M,L,X
    incomplete directory is not ready

YoloImagePolicyTest:
    accepts supported content types with parameters
    rejects unsupported content type and empty body

YoloPreprocessorTest:
    landscape and portrait images produce 640x640 input
    letterbox scale and padding map a detection back to original coordinates

YoloPostprocessorTest:
    decodes [1,84,8400] output
    decodes [1,8400,84] output
    filters low confidence and removes same-class overlapping boxes
    keeps overlapping boxes from different classes

YoloBenchmarkTest:
    calculates average, P50, P95 and FPS from fixed samples
    rejects invalid warmup and run counts

YoloHttpJsonTest:
    escapes model and error text
    returns detection timings and benchmark rows

YoloHttpServerTest:
    root endpoint contains model selector and benchmark button
    models endpoint lists five models
    illegal model and invalid method return expected status
    busy flag rejects concurrent detection and benchmark

CpuModeTest:
    persisted values 0/1/2 map to AUTO/BIG/LITTLE
    unknown persisted value falls back to AUTO
```

## 当前验证记录

```text
ValidationRecord:
    device = Android 9 arm64, 192.168.1.6:5555
    image = bus.jpg
    yolo11n detections = bus(classId=5, confidence=0.939) + 4 persons(classId=0)
    confidence values = [0.939, 0.902, 0.849, 0.833, 0.396]
    conclusion = single-image qualitative smoke test passed
    precision/recall/mAP = not measured because no labeled validation dataset was supplied
```
