# 服务器 API 使用说明与命令行工具

## 需求等级与范围

这是一次跨模块的 L6 工具与文档接入：不改变现有服务器 API 协议，基于真实 Express 路由建立可检索的 API 使用说明，并提供用户和 AI 都能直接执行的 Bash 命令行入口。

范围包括：

- 汇总主服务器、日志大脑和 Chat2API 网关的 HTTP 接口。
- 提供状态、媒体播放、TTS、ASR、OCR、YOLO、媒体查询等高频操作脚本。
- 提供 `api-request.sh` 调用任意已记录的 HTTP 路由。
- 所有脚本使用环境变量配置服务器地址，stdout 输出机器可读 JSON，失败使用非零退出码。
- 高风险删除、导入、停止和重启操作默认拒绝，必须显式确认。

不在本次范围内：

- 修改现有 API 的请求或返回协议。
- 为每个内部 WebSocket 消息单独写 Bash 客户端。
- 自动执行会删除数据、改变全局配置或重启服务的测试。

## 文件设计

- `docs/api-usage.md`：面向用户和 AI 的完整 HTTP API 目录、命令示例和返回约定。
- `scripts/api-tests/common.sh`：服务器地址、HTTPS、自签名证书、超时、JSON 工具和 HTTP 错误处理。
- `scripts/api-tests/api-request.sh`：通用 GET/POST/PUT/DELETE 调用器，支持 JSON、multipart 和显式危险操作确认。
- `scripts/api-tests/*.sh`：高频业务操作的薄封装脚本。
- `scripts/api-tests/run-all.sh`：只执行安全只读探针，输出 JSON Lines。

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
    stderr = curl 或服务端 JSON 错误
    exit code != 0

帮助：
    command --help 不请求服务器，exit code = 0
```

脚本不在参数中保存密码、Cookie 或 API Key；如未来服务器增加鉴权，由环境变量或通用请求头传入。

## 已完成实现

- 公共脚本已固定本机回环地址直连，避免开发环境的 `HTTP(S)_PROXY` 干扰本机 HTTPS。
- OCR 脚本支持源码路由允许的 `shortSide=0` 或 `256..2048`；YOLO 脚本不暴露未实现的缩放参数。
- `run-all.sh` 已实现为 JSON Lines 只读探针，`npm run api:test` 作为统一入口。

## 高频操作

```text
health.sh                         GET /api/status
media-list.sh                     GET /media-list
play.sh --file FILE --display ID  POST /upload-file multipart(file, displayId)
tts-generate.sh --text TEXT       POST /api/tts/generate JSON
asr-recognize.sh --audio FILE     POST /api/asr/recognize multipart(audio)
vision-ocr.sh --image FILE        POST /api/vision/ocr multipart(image, displayId, shortSide?)
vision-yolo.sh --image FILE       POST /api/vision/yolo multipart(image, displayId?)
api-request.sh METHOD PATH ...    任意 HTTP 路由
```

`run-all.sh` 只访问 `/api/status`、`/api/asr/status`、`/api/tts/config`、`/api/vision/status`、`/media-list`、`/api/actors` 和 `/api/system-stats` 等无副作用接口。
