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

chat-history.js:
    parse --mode, --target, --session, --profile, --limit, --sessions, --tui and --width
    if sessions is false:
        call existing GET /api/chat/history
        validate response as JSON object with history array
        apply read-only client-side filters and keep latest limit messages
    if sessions is true:
        call existing GET /api/chat/sessions with optional target query
        call existing GET /api/chat/history only to detect the group chat entry
        validate response as JSON object with sessions array
        validate history response as JSON object with history array
        append one virtual group session when group history exists
        use the first user/control message as the virtual group session name
        filter sessions locally by the supplied target/session/mode
        map each entry to { target: role name or 群聊, name: session name }
        output { status, sessions } without chat records, ids or timestamps
    if --tui:
        if sessions is true:
            render only the role name and session name in a session panel
        else:
            render legacy user/assistant pairs and modern role/content messages
            wrap text by display width and print a terminal-readable panel
    else:
        if sessions is false:
            print the history API JSON envelope
        if sessions is true:
            print { status, sessions } where sessions only contains target and name
    never call POST, PUT or DELETE chat routes

existing GET /api/chat/sessions:
    if target exists:
        return { status: 'success', sessions: listSessions(target) }
    return { status: 'success', sessions: listAllSessions() }

listAllSessions():
    collect targets from configured session map and private history
    for each target:
        recover missing default/session entries from private history
        flatten each session as { mode: 'private', target, id, name, createdAt }
    sort by target and preserve session metadata

one-time session data migration:
    read existing chat-session.json and all chat-history*.json files
    for generic names such as 默认会话、新会话 or qwen-import-*:
        find the earliest user/control message for the same private target/sessionId
        normalize that message into a short session name
        write the renamed private session metadata back once
    preserve explicitly meaningful names and all chat messages
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
    assert chat-history.js only reads existing GET history/sessions routes
    assert --sessions does not require target and returns role name plus session name only
    assert chat TUI renders session names without chat records
    assert existing target-specific sessions response remains compatible

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
