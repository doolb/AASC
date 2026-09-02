# 服务器 API 使用说明与命令行工具实现规格

## 真实接口目录生成

```text
读取 server-app.js、log-brain-api.js 和 Chat2API gateway 的路由声明
按路径与 HTTP method 去重
在 docs/api-usage.md 按模块记录：请求格式、字段、返回示例、副作用、对应脚本
明确 WebSocket-only 能力不伪装成 HTTP API
```

## 公共 Node.js 工具伪代码

```text
common.js:
    BASE_URL = AASC_URL or https://127.0.0.1:8081
    if AASC_INSECURE != 0: rejectUnauthorized = false

    api_request(method, path, options):
        url = BASE_URL + path unless path is an absolute URL
        run Node http/https request
        encode JSON or multipart fields/files
        if transport fails:
            print error to stderr
            return nonzero
        if HTTP status >= 400:
            print response body to stderr
            return nonzero
        print response body to stdout
```

## 通用调用器伪代码

```text
api-request.js METHOD PATH [--json JSON] [--form key=value] [--file key=FILE]
    parse --help without network access
    validate method and path
    convert --json to Content-Type application/json + request body
    convert --form and --file to Node multipart body
    if method/path is dangerous and --confirm is absent:
        print confirmation error to stderr
        return nonzero
    call common.requestText
```

```text
common.js:
    Node http/https 请求按 AASC_URL 直连
    HTTP >= 400 时把响应体放到 stderr，并以非零状态返回
```

## 高频脚本伪代码

```text
health.js:
    common.api_request GET /api/status

play.js:
    require --file and --display
    common.api_request POST /upload-file -F file=@FILE -F displayId=DISPLAY

tts-generate.js:
    require --text
    body = { text, optional voice, optional numeric speed }
    common.api_request POST /api/tts/generate --json body

asr-recognize.js:
    require --audio
    common.api_request POST /api/asr/recognize -F audio=@AUDIO

vision-ocr.js:
    require --image
    optional displayId and shortSide
    validate shortSide as 0 or integer 256..2048
    common.api_request POST /api/vision/ocr with multipart fields

vision-yolo.js:
    require --image
    optional displayId
    common.api_request POST /api/vision/yolo with multipart fields
    each detection returns classId and className when the model labels contain that class
```

## 安全测试入口伪代码

```text
run-all.js:
    for each read-only endpoint:
        execute probe
        output one JSON line: { name, ok, response or error }
    return nonzero when any probe cannot be completed
```

## 测试规格

```text
静态契约测试：
    assert all user-facing scripts exist and have Node shebang
    assert all API scripts use common.js
    assert help paths do not make network requests
    assert play/TTS/ASR/OCR/YOLO flags and API paths are present
    assert package.json contains api:test
    assert docs list routes and AI JSON/error contract

本机命令测试：
    command --help for every script
    run health/media-list/run-all against local server
    run TTS/ASR/vision only when matching service/file/display is available
    verify failed HTTP status returns nonzero and writes error to stderr
    verify dangerous interface without confirmation does not make a request

真实验证记录：
    run-all.js 和 npm run api:test 的只读探针全部成功
    /mnt/tmp/infinity_nikki_main.png 的 OCR shortSide=960 和 YOLO11n 请求成功
    TTS 生成、生成音频的 ASR 识别、播放上传请求成功
    无 /mnt/tmp 音频文件，ASR 使用本次生成的 TTS WAV 代替独立音频样本
```
