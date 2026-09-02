# AASC 服务器 API 使用说明

本文档按当前 `/mnt/AASC` 服务端源码整理，适合用户手动调用，也适合 AI 通过命令行读取 stdout、stderr 和退出码执行。服务器默认监听地址为 `https://127.0.0.1:8081`；如果部署地址、端口或协议不同，请先设置 `AASC_URL`。

## 1. 调用约定

```bash
export AASC_URL='https://127.0.0.1:8081'
export AASC_INSECURE=1          # 本机自签名证书使用；正式证书可设为 0
export AASC_TIMEOUT_SECONDS=120
```

直接使用 `curl` 时，本机自签名 HTTPS 等价于加 `-k`。命令行脚本位于 `scripts/api-tests/`，可从项目根目录运行：

```bash
scripts/api-tests/health.sh
scripts/api-tests/media-list.sh
scripts/api-tests/api-request.sh GET /api/status
npm run api:test
```

脚本约定如下：

- 成功响应原样写到 stdout，通常是 JSON；二进制下载接口不要把 stdout 当 JSON 解析。
- 网络错误、HTTP 4xx/5xx 和参数错误写到 stderr，并返回非零退出码。
- `--help` 只显示帮助，不请求服务器。
- 默认允许本机自签名证书；设置 `AASC_INSECURE=0` 后由 curl 校验证书。
- 删除、导入、停止 Agent、重启等操作必须传 `--confirm`，或设置 `API_CONFIRM=1`。
- 当前服务端没有统一鉴权中间件。脚本和文档不保存密码、Cookie、Token 或 API Key；如果部署层增加鉴权，可通过 `api-request.sh --header 'Authorization: ...'` 传递。

通用调用器：

```bash
scripts/api-tests/api-request.sh GET /api/status
scripts/api-tests/api-request.sh POST /api/tts/generate \
  --json '{"text":"你好，AASC"}'
scripts/api-tests/api-request.sh PUT /api/device-settings/display-1 \
  --json '{"volume":60}'
scripts/api-tests/api-request.sh POST /api/asr/recognize \
  --file audio=/path/to/sample.wav
```

`api-request.sh` 支持 `--json JSON`、`--form KEY=VALUE`、`--file KEY=FILE`、`--header HEADER` 和 `--confirm`。路径可以是相对当前服务器的 `/api/...`，也可以直接传完整 `http://` 或 `https://` URL。

## 2. 高频操作

### 2.1 查询服务器状态

```bash
scripts/api-tests/health.sh
```

等价请求：

```bash
curl -k -sS "$AASC_URL/api/status"
```

### 2.2 上传并播放媒体

`POST /upload-file` 接收 multipart 字段 `file` 和 `displayId`。服务器保存文件、更新当前媒体，并向指定在线显示端发送播放消息。

```bash
scripts/api-tests/play.sh \
  --file ./media/demo.mp4 \
  --display display-1
```

等价请求：

```bash
curl -k -sS -X POST "$AASC_URL/upload-file" \
  -F 'file=@./media/demo.mp4' \
  -F 'displayId=display-1'
```

### 2.3 TTS 生成

`POST /api/tts/generate` 接收 JSON：`text` 必填，`voice` 和 `speed` 可选。成功返回 `audioUrl`，脚本只负责生成，不自动播放。

```bash
scripts/api-tests/tts-generate.sh \
  --text '你好，这是一次 TTS 测试' \
  --voice 'Microsoft Xiaoxiao' \
  --speed 1.0
```

等价请求：

```bash
curl -k -sS -X POST "$AASC_URL/api/tts/generate" \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，这是一次 TTS 测试","voice":"default","speed":1.0}'
```

返回示例：

```json
{"status":"success","audioUrl":"/uploads/tts/xxx.wav","message":"TTS生成成功"}
```

服务器返回的 `audioUrl` 可能是相对路径，使用时拼接 `AASC_URL`；如果要进一步播放，先下载到本地，再执行 `play.sh`：

```bash
curl -k -sS "$AASC_URL/uploads/tts/xxx.wav" -o /tmp/aasc-tts.wav
scripts/api-tests/play.sh --file /tmp/aasc-tts.wav --display display-1
```

### 2.4 ASR 识别

`POST /api/asr/recognize` 接收 multipart 字段 `audio`。实际识别设备由服务器配置决定：`server` 使用服务端 ASR，`display` 转发到支持 ASR 的显示端。

```bash
scripts/api-tests/asr-recognize.sh --audio ./audio/sample.wav
```

等价请求：

```bash
curl -k -sS -X POST "$AASC_URL/api/asr/recognize" \
  -F 'audio=@./audio/sample.wav'
```

成功时通常返回 `{"status":"success","text":"..."}`；静音、无效内容或声纹未匹配时可能返回 `status: "ignored"`，这不是 HTTP 调用失败，应由调用方读取 `status` 判断业务结果。

### 2.5 显示端 OCR

OCR 由服务器接收图片后转发给在线且声明 `ocrAvailable=true` 的显示端，服务器本身不加载 OCR 模型。`displayId` 可选；不传时由服务器选择支持 OCR 的显示端。`shortSide` 可选，取 `0` 或 `256..2048` 的整数，表示显示端推理前的图片短边缩放尺寸。

```bash
scripts/api-tests/vision-ocr.sh \
  --image /mnt/tmp/game.png \
  --display display-1 \
  --short-side 960
```

也可以通过 `imageBase64` 发送 JSON/表单中的 base64，但推荐使用脚本的 multipart 文件方式：

```bash
curl -k -sS -X POST "$AASC_URL/api/vision/ocr" \
  -F 'image=@/mnt/tmp/game.png' \
  -F 'displayId=display-1' \
  -F 'shortSide=960'
```

返回会包含 `status: "success"`、实际 `displayId` 和 `requestId`，识别结果字段由显示端 OCR 实现返回。

### 2.6 显示端 YOLO11n

YOLO 路由同样只负责服务器到显示端的转发，要求显示端声明 `yolo11nAvailable=true`。当前 YOLO 接口不接受 `shortSide` 参数。

```bash
scripts/api-tests/vision-yolo.sh \
  --image /mnt/tmp/game.png \
  --display display-1
```

等价请求：

```bash
curl -k -sS -X POST "$AASC_URL/api/vision/yolo" \
  -F 'image=@/mnt/tmp/game.png' \
  -F 'displayId=display-1'
```

### 2.7 视觉能力和显示端状态

```bash
curl -k -sS "$AASC_URL/api/vision/status"
curl -k -sS "$AASC_URL/api/actors"
```

`/api/vision/status` 返回 `serverInference: false`，并列出每个在线显示端的 `ocrAvailable`、`yolo11nAvailable` 和 `cpuStatus`。`/api/actors`、`/api/map-data` 的显示端能力列表也会包含 OCR 和 YOLO11n。

## 3. HTTP API 目录

下表是当前服务端源码注册的业务 HTTP 路由。`:id`、`:filename`、`:displayId`、`:ip` 是路径参数，`*` 表示剩余文件路径。除特别注明外，JSON 请求使用 `Content-Type: application/json`，成功响应是 JSON。

### 3.1 视觉、媒体和语音

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| POST | `/api/vision/ocr` | multipart `image`；可选 `displayId`、`targetDisplay`、`shortSide` | 转发到显示端并产生推理负载 |
| POST | `/api/vision/yolo` | multipart `image`；可选 `displayId`、`targetDisplay` | 转发到显示端并产生推理负载 |
| GET | `/api/vision/status` | 返回服务器转发声明和显示端视觉能力 | 只读 |
| POST | `/upload-file` | multipart `file`、`displayId` | 保存文件并播放 |
| GET | `/media-list` | 返回上传媒体列表 | 只读 |
| DELETE | `/media/:filename` | 删除上传目录中的文件 | 删除文件，需确认 |
| GET | `/api/media-proxy?url=URL` | 代理远程媒体，支持部分 Range | 读取远端资源 |
| POST | `/api/tts/generate` | JSON `text`，可选 `voice`、`speed` | 生成音频文件 |
| GET | `/api/tts/config` | 返回 TTS 服务配置 | 只读 |
| POST | `/api/tts/config` | JSON 更新 `serviceUrl`、默认音色/语速及超时字段 | 修改配置 |
| GET | `/api/asr/status` | 返回 ASR ready、device、mode | 只读 |
| POST | `/api/asr/recognize` | multipart `audio` | ASR 推理 |

### 3.2 语音配置、模型和声纹

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| GET/POST | `/api/config/localAsr` | JSON `enabled` | 修改本地 ASR 开关 |
| GET/POST | `/api/config/controlTheme` | JSON `theme` | 修改控制端主题 |
| GET/POST | `/api/config/serverVoice` | JSON `asrEnabled`、`ttsEnabled` | 修改服务器语音开关 |
| GET/POST | `/api/config/asrDevice` | JSON `device: server\|display` | 修改 ASR 设备 |
| GET/POST | `/api/config/asrOptions` | JSON `denoise`；语言固定为 `zh` | 修改 ASR 选项 |
| GET/POST | `/api/config/ttsDevice` | JSON `device: server\|display` | 修改 TTS 设备 |
| GET/POST | `/api/config/cpuAffinity` | JSON 由配置模块校验的大核/小核数量 | 修改显示端 CPU 配置 |
| GET/POST | `/api/config/asrMode` | JSON `mode: embedded\|isolated` | 修改 ASR 运行模式 |
| GET | `/api/asr/model/:filename` | 下载白名单内 SenseVoice 文件 | 只读二进制 |
| GET | `/api/voiceprint/model/:filename` | 下载白名单内声纹模型文件 | 只读二进制 |
| GET | `/api/tts/model-manifest` | 下载 TTS `manifest.json` | 只读 JSON |
| GET | `/api/tts/model/:filename` | 下载白名单内 TTS 模型文件 | 只读二进制 |
| GET/POST | `/api/voiceprint/config` | 声纹开关、提取位置、阈值等 | 修改配置 |
| GET | `/api/voiceprint/db` | 返回声纹库 | 只读 |
| POST | `/api/voiceprint/remove` | JSON `name` | 删除声纹 |
| POST | `/api/voiceprint/register` | multipart `audio`、`name` | 写入声纹库 |
| GET | `/api/repair-mode/config` | 返回修复模式公开配置 | 只读 |
| POST | `/api/repair-mode/config` | 更新修复模式配置 | 修改配置，谨慎执行 |

### 3.3 子服务器和全局配置

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| GET | `/api/config` | 返回完整服务端配置 | 注意可能包含内部配置，勿公开转发 |
| GET | `/api/subservers` | 返回子服务器列表 | 只读 |
| POST | `/api/subservers` | JSON `id`、`url` 必填，可选 `name`、`maxDisplays`、`priority`、`enabled` | 添加并保存子服务器 |
| DELETE | `/api/subservers/:id` | 删除子服务器 | 删除配置，需确认 |
| GET | `/api/subservers/health` | 检查所有子服务器健康状态 | 发起健康请求 |

### 3.4 聊天、配置和导入导出

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| GET | `/api/chat/config` | 返回聊天配置 | 只读 |
| POST | `/api/chat/config` | JSON 聊天配置 | 修改配置 |
| POST | `/api/ai-roles/stop-all` | 停止所有 Agent | 停止运行任务，需确认 |
| GET/POST | `/api/chat/profiles` | GET 返回配置；POST 使用 JSON `profiles` | 修改配置 |
| POST | `/api/chat/profiles/switch` | JSON `name` | 切换配置 |
| GET | `/api/chat/history` | 返回当前聊天历史 | 只读 |
| POST | `/api/chat/clear` | JSON 可选 `mode`、`target`、`sessionId` | 清空历史，需确认 |
| GET | `/api/chat/history/export` | 下载聊天历史 JSON | 只读下载 |
| POST | `/api/chat/history/import` | JSON `history` 或完整导入对象，可选 `mode` | 导入历史，需确认 |
| GET | `/api/aasc-user/export` | 下载用户配置 JSON | 只读下载 |
| POST | `/api/aasc-user/import` | JSON `config` 或完整导入对象，可选 `mode` | 导入配置，需确认 |
| POST | `/api/chat/round` | JSON 按聊天模块约定指定会话轮次 | 删除一轮对话，需确认 |
| GET | `/api/chat/sessions?target=TARGET` | 查询指定目标会话 | 只读 |
| POST | `/api/chat/sessions/create` | JSON `target`、可选 `name` | 创建会话 |
| POST | `/api/chat/sessions/delete` | JSON `target`、`sessionId` | 删除会话，需确认 |
| POST | `/api/chat/sessions/switch` | JSON `target`、`sessionId` | 切换会话 |
| GET/POST | `/api/chat/templates` | GET 返回模板；POST 使用 JSON `templates` | 修改模板 |
| POST | `/api/chat/templates/add` | JSON 新模板字段 | 添加模板 |
| DELETE | `/api/chat/templates/:id` | 删除模板 | 删除数据，需确认 |

### 3.5 提醒和媒体库

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| GET | `/api/reminders` | 返回全部提醒 | 只读 |
| POST | `/api/reminders` | JSON `content`、`time` 必填，可选 `type`、`methods`、`repeat` | 创建提醒 |
| PUT | `/api/reminders/:id` | JSON 更新字段 | 修改提醒 |
| DELETE | `/api/reminders/:id` | 删除提醒 | 删除数据，需确认 |
| POST | `/api/reminders/:id/toggle` | JSON `enabled` | 启用/禁用提醒 |
| POST | `/api/reminders/test` | JSON 测试提醒数据 | 发送测试提醒 |
| POST | `/api/reminders/:id/test` | 可选 JSON `displayId` | 发送测试提醒 |
| GET | `/api/media-libraries` | 返回媒体库和默认媒体库 ID | 只读 |
| POST | `/api/media-libraries` | JSON `name`、`type`；按 provider 使用 `path`、`url`、SMB 字段等 | 新增媒体库 |
| PUT | `/api/media-libraries/:id` | JSON `name`、`readonly`、`isDefault` | 修改媒体库 |
| DELETE | `/api/media-libraries/:id` | 删除媒体库 | 删除配置，需确认 |
| GET | `/api/media-libraries/:id/list?path=/` | 列出目录 | 只读 |
| POST | `/api/media-libraries/:id/upload` | multipart `file`，可选 `path` | 上传文件 |
| DELETE | `/api/media-libraries/:id/file?path=PATH` | 删除文件 | 删除远端文件，需确认 |
| POST | `/api/media-libraries/:id/folder` | JSON `name`，可选 `path` | 创建目录 |
| DELETE | `/api/media-libraries/:id/folder?path=PATH` | 删除目录 | 删除远端目录，需确认 |
| POST | `/api/media-libraries/:id/set-default` | 无特殊请求体 | 修改默认媒体库 |
| GET | `/api/media-libraries/:id/proxy/*` | 读取媒体库文件流，支持 Range | 只读流 |

### 3.6 诊断、地图、设备和系统

| 方法 | 路径 | 请求/说明 | 副作用 |
|---|---|---|---|
| GET | `/api/logs/brain-summary` | 日志大脑摘要 | 只读/可能调用 LLM |
| POST | `/api/logs/brain-judge` | 日志大脑判断，请求体由日志模块定义 | 可能调用 LLM |
| POST | `/api/logs/brain-diagnose` | 日志大脑诊断，请求体由日志模块定义 | 可能调用 LLM |
| GET | `/api/logs` | 可选 query：`search`、`levels`、`devices`、`categories`、`timeRange`、`limit` | 只读 |
| GET | `/api/system-stats` | 返回系统监控统计 | 只读 |
| GET | `/api/map-data` | 返回服务器、显示端、控制端及能力 | 只读 |
| GET | `/api/actors` | 返回执行者及能力 | 只读 |
| POST | `/api/time/parse` | JSON `text` | 只读计算 |
| GET | `/api/map-positions` | 返回地图位置 | 只读 |
| PUT | `/api/map-positions/:id` | JSON `position: {x, y}` | 修改位置 |
| GET/POST | `/api/mute` | GET 查询；POST 全部静音 | POST 会改变显示端状态 |
| POST | `/api/unmute` | 取消所有显示端静音 | 改变显示端状态 |
| GET | `/api/device-events` | 返回设备连接/断开事件配置 | 只读 |
| PUT | `/api/device-events/:ip` | JSON `onConnect`、`onDisconnect` | 修改配置 |
| DELETE | `/api/device-events/:ip` | 删除设备事件配置 | 删除配置，需确认 |
| GET | `/api/display-version` | 返回显示端静态文件版本时间戳 | 只读 |
| GET | `/api/device-settings/:displayId` | 返回在线或已保存的显示端设置 | 只读 |
| PUT | `/api/device-settings/:displayId` | 允许更新 `rotation`、`fit`、`volume`、`crop`、`isPlaying` | 修改并通知显示端 |
| POST | `/api/restart` | 请求服务器重启 | 重启服务，需确认 |

### 3.7 Chat2API 网关

`/api/chat2api-gateway/:instanceId` 是动态挂载的 Chat2API 网关。具体子路径、请求协议和流式返回由网关模块维护，调用时使用实际 `instanceId`，例如：

```bash
scripts/api-tests/api-request.sh POST \
  /api/chat2api-gateway/my-instance/v1/chat/completions \
  --json '{"model":"...","messages":[{"role":"user","content":"你好"}]}'
```

不要把网关的 OpenAI 兼容子路径误认为主服务器固定路由；如果需要精确接口，以 `src/apps/server/modules/chat2api/chat2api-gateway.js` 为准。

## 4. WebSocket 边界

任务引擎和显示端控制不是独立的 HTTP API。服务端通过 WebSocket 承载 `task:*` 消息，例如 `task:submit`、`task:run`、`task:rerun`、`task:stop`、`task:status`、`task:result`、`task:list`、`task:update`、`task:delete`、`task:get_instance_logs`、`task:delete_instance`、`task:widget_action`、`task:update_instance_params`、`task:get_config`、`task:set_config`、`task:clear_instance_logs`、`task:link`、`task:unlink` 和 `task:progress`。

本文档的 Bash 工具只覆盖 HTTP，不伪造 WebSocket 调用。需要执行任务时，应使用现有网页/客户端 WebSocket 连接，或使用专门的 WebSocket 客户端实现消息协议。

## 5. AI/脚本调用建议

推荐 AI 先调用：

```bash
scripts/api-tests/health.sh
scripts/api-tests/run-all.sh
```

`run-all.sh` 只请求无副作用接口，并输出 JSON Lines，例如每行包含 `name`、`ok` 以及 `response` 或 `error`。业务脚本返回服务端原始 JSON，AI 应同时检查：

1. Shell 退出码是否为 `0`。
2. JSON 的 `status` 是否为 `success`、`ok` 或业务允许的 `ignored`。
3. OCR/YOLO 是否有支持能力的在线显示端。
4. ASR 是否 `ready`，以及当前 `device` 是 `server` 还是 `display`。

高风险调用示例（仅展示确认方式，执行前确认目标）：

```bash
scripts/api-tests/api-request.sh DELETE /media/file.mp4 --confirm
scripts/api-tests/api-request.sh POST /api/chat/round --json '{"target":"group"}' --confirm
API_CONFIRM=1 scripts/api-tests/api-request.sh POST /api/restart
```

## 6. 测试脚本清单

| 脚本 | 用途 |
|---|---|
| `scripts/api-tests/common.sh` | 公共 curl、地址、HTTPS、超时和错误处理；由其他脚本 source |
| `scripts/api-tests/api-request.sh` | 任意 HTTP 方法、JSON、表单、文件和请求头 |
| `scripts/api-tests/health.sh` | `/api/status` |
| `scripts/api-tests/media-list.sh` | `/media-list` |
| `scripts/api-tests/play.sh` | 上传并播放媒体 |
| `scripts/api-tests/tts-generate.sh` | TTS 生成 |
| `scripts/api-tests/asr-recognize.sh` | ASR 音频识别 |
| `scripts/api-tests/vision-ocr.sh` | OCR 图片识别，支持短边参数 |
| `scripts/api-tests/vision-yolo.sh` | YOLO11n 图片检测 |
| `scripts/api-tests/run-all.sh` | 串行执行只读健康探针 |

脚本语法和静态契约测试：

```bash
node --test tests/api-cli-contract.test.js
bash -n scripts/api-tests/*.sh
```
