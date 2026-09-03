# 服务器 API 使用说明与命令行工具

## 需求等级与范围

这是一次跨模块的 L6 工具与文档接入：保持现有服务器 API 的请求方式和原有字段不变，并为 YOLO 检测项补充可选的 `className` 字段；同时基于真实 Express 路由建立可检索的 API 使用说明，并提供用户和 AI 都能直接执行的跨平台 Node.js 命令行入口。

范围包括：

- 汇总主服务器、日志大脑和 Chat2API 网关的 HTTP 接口。
- 提供状态、媒体播放、TTS、ASR、OCR、YOLO、媒体查询等高频操作脚本。
- 提供 `api-request.js` 调用任意已记录的 HTTP 路由。
- 所有脚本使用环境变量配置服务器地址，stdout 输出机器可读 JSON，失败使用非零退出码。
- 高风险删除、导入、停止和重启操作默认拒绝，必须显式确认。

不在本次范围内：

- 修改现有 API 的请求方式或删除原有返回字段；YOLO 新增的 `className` 为兼容性附加字段。
- 为每个内部 WebSocket 消息单独写 Node.js 客户端。
- 自动执行会删除数据、改变全局配置或重启服务的测试。

## 文件设计

- `docs/api-usage.md`：面向用户和 AI 的完整 HTTP API 目录、命令示例和返回约定。
- `scripts/api/common.js`：服务器地址、HTTPS、自签名证书、超时、JSON 工具和 HTTP 错误处理。
- `scripts/api/api-request.js`：通用 GET/POST/PUT/DELETE 调用器，支持 JSON、multipart 和显式危险操作确认。
- `scripts/api/*.js`：高频业务操作的薄封装脚本。
- `scripts/api/run-all.js`：只执行安全只读探针，输出 JSON Lines。

## 面向 AI 的命令行契约

```text
环境变量：
    AASC_URL = https://127.0.0.1:8081
    AASC_INSECURE = 1          # 本机自签名 HTTPS 默认允许；远程环境可设为 0
    AASC_TIMEOUT_SECONDS = 120

成功：
    stdout = 服务端原始 JSON
    exit code = 0

失败：
    stderr = Node.js 网络或服务端 JSON 错误
    exit code != 0

帮助：
    command --help 不请求服务器，exit code = 0
```

脚本不在参数中保存密码、Cookie 或 API Key；如未来服务器增加鉴权，由环境变量或通用请求头传入。

## 已完成实现

- 公共脚本已固定本机回环地址直连，避免开发环境的 `HTTP(S)_PROXY` 干扰本机 HTTPS。
- OCR 脚本支持源码路由允许的 `shortSide=0` 或 `256..2048`；YOLO 脚本不暴露未实现的缩放参数。
- `run-all.js` 已实现为 JSON Lines 只读探针，`npm run api:test` 作为统一入口。

## 高频操作

```text
health.js                         GET /api/status
media-list.js                     GET /media-list
play.js --file FILE --display ID  POST /upload-file multipart(file, displayId)
tts-generate.js --text TEXT       POST /api/tts/generate JSON
asr-recognize.js --audio FILE     POST /api/asr/recognize multipart(audio)
vision-ocr.js --image FILE        POST /api/vision/ocr multipart(image, displayId, shortSide?)
vision-yolo.js --image FILE       POST /api/vision/yolo multipart(image, displayId?)
chat-history.js [--sessions]      GET history 或 sessions，只读查看聊天历史或 session 名称
api-request.js METHOD PATH ...    任意 HTTP 路由
```

`run-all.js` 只访问 `/api/status`、`/api/asr/status`、`/api/tts/config`、`/api/vision/status`、`/media-list`、`/api/actors` 和 `/api/system-stats` 等无副作用接口。

## 只读聊天查看

复用现有 `GET /api/chat/history`，新增客户端脚本 `scripts/api/chat-history.js`：默认把服务端 JSON 原样输出；传入 `--tui` 时，在本地将历史消息渲染为终端面板。`--mode`、`--target`、`--session`、`--profile` 和 `--limit` 只在客户端过滤已获取的历史，不改变服务端数据。

传入 `--sessions` 时，脚本调用现有 `GET /api/chat/sessions` 获取私聊 session，并调用现有 `GET /api/chat/history` 只识别群聊条目；`--target` 可选，省略时不限制目标。服务端保留带 target 请求的原有数组格式，无 target 时返回带 `target` 的扁平 session 列表。CLI 输出只保留 `target`（私聊角色名或“群聊”）和 `name`（session 名），不包含聊天记录、ID 或创建时间；`--sessions --tui` 只显示角色名和 session 名面板。

历史导入 session 的技术名称已通过一次性数据迁移改为首条用户消息标题；查看命令只读取迁移后的名称，不再动态改名。

本功能不新增服务端路由，不发送消息，不清空、删除、导入或修改聊天；只扩展现有 sessions 路由对缺省 target 的只读查询。实时消息跟随仍属于现有 WebSocket 边界，暂不纳入只读历史查看脚本。
