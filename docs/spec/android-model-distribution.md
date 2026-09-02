# 正式 Android 统一模型分发实现规格（伪代码）

## 服务器模型清单伪代码

```text
ModelDistributionService:
    groups = {
        vision: {
            rapidocr: [det, cls, rec, dict],
            yolo11n/s/m/l/x: [yolo11*.onnx, yolo11*.classes.json]
        },
        speech-enhancement: {
            gtcrn: [gtcrn_simple.onnx]
        }
    }

    manifest(group):
        for each configured model:
            include only regular files that exist under the fixed resource directory
            calculate or reuse cached SHA-256, size and mtime
        return JSON {status: success, models: [{id, files: [{name, size, sha256}]}]}

    resolve(group, modelId, filename):
        reject modelId/filename not in fixed manifest whitelist
        reject when any file in the selected model definition is missing or not regular
        resolve real path and reject files whose symlink target is outside modelRoot
        return fixed resource path

GET /api/vision/model-manifest:
    return manifest(vision)

GET /api/vision/model/:modelId/:filename:
    file = resolve(vision, modelId, filename)
    stream file with Content-Length

GET /api/speech-enhancement/model-manifest:
    return manifest(speech-enhancement)

GET /api/speech-enhancement/model/:filename:
    file = resolve(speech-enhancement, gtcrn, filename)
    stream file with Content-Length
```

## APK 通用下载伪代码

```text
RemoteModelManager.ensure(baseUrl, group, modelId):
    manifest = GET baseUrl + group manifest
    selected = manifest.models.find(id == modelId)
    reject when selected is absent or files is empty
    on process start, recover a leftover backup directory from an interrupted install
    create a sibling staging directory under the manager's fixed filesDir/models cache directory
    for file in selected.files:
        if local file size/mtime, cached .manifest.json metadata and the process verification cache match server file metadata:
            continue
        if the process verification cache misses:
            calculate local SHA-256 once and record the file size/mtime stamp
        download to staging/file.tmp
        verify SHA-256(staging/file.tmp) == file.sha256
        atomically rename staging/file.tmp to staging/file
    save the server manifest as staging/.manifest.json atomically
    atomically swap the complete staging directory with the active cache directory
    keep the previous active directory until the new engine session loads successfully
    finalize the install after load success; rollback to the previous directory on load failure
    return complete local directory

on download/hash/load failure:
    delete only the staging directory and temporary files; keep the previous complete cache
    return structured error without creating ONNX session

HTTPS download:
    use system certificate validation for normal HTTPS
    allow the configured development self-signed server certificate only by its pinned SHA-256 fingerprint
HTTP download:
    allow only loopback development addresses
    reject LAN/public HTTP addresses before reading a manifest or model
```

## 视觉运行时伪代码

```text
VisionRuntime:
    create one worker and one waiting slot
    keep VisionModelManager, RapidOcrEngine and YoloDetector

OCR request:
    directory = VisionModelManager.ensure(serverOrigin, vision, rapidocr)
    load RapidOCR from directory with ORT 1/1 and single-little-core policy
    recognize image with optional shortSide

YOLO request(modelId = yolo11n):
    model = YoloModel.fromId(modelId)
    directory = VisionModelManager.ensure(serverOrigin, vision, model.id)
    load model.fileName with ORT 1/1 and single-little-core policy
    read model.classNamesFileName and map each detection classId to className
    detect and return the selected model ID with classId and className
```

## 降噪运行时伪代码

```text
prepareAudio(samples, enabled):
    if enabled is false: return samples
    synchronize denoise lock
    if engine is not loaded:
        file = DenoiseModelManager.ensure(serverOrigin, speech-enhancement, gtcrn)
        load file into SherpaDenoiseEngine
    return engine.process(samples)
```

## 构建约束伪代码

```text
Gradle preBuild:
    do not copy res/models into generated APK assets
    do not export YOLO ONNX into generated APK assets
    package only code and runtime dependencies
```

## 测试规格

```text
server unit tests:
    manifest contains RapidOCR files and existing YOLO ONNX plus class-name sidecar files only
    path traversal and unknown model/file return 400
    missing model file returns 404
    download response has matching Content-Length and SHA-256

Kotlin JVM tests:
    no asset-copy API is used for vision/denoise
    model ID maps to yolo11n/s/m/l/x file names
    hash mismatch rejects the temporary file
    complete local cache avoids a second download

APK/build tests:
    Gradle source has no bundled vision/denoise prepare task
    APK assets do not contain RapidOCR, YOLO or GTCRN model files
    debug build and Android arm64 install succeed
```
