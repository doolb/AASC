# 豆包网页内置任务

在任务面板启动“豆包网页” (`doubao.web`)。任务默认使用网页内 `fetch()`，桌面默认启动 `vivaldi`、本机调试端口 `9224`，兼容 API 默认监听 `127.0.0.1:9091`。可在任务参数中指定浏览器可执行文件、调试端口和唯一豆包账号 ID。桌面使用每个账号独立的 Chat2API profile；首次使用需在弹出的专用浏览器窗口登录豆包，验证码由用户在该窗口手动处理。任务不会自动删除官网会话或更换账号。

Android Offline 在隔离进程 WebView 中发送相同的官网请求，并复用现有 Chat2API 外部登录保存的 Cookie。当前只完成源码和 Kotlin 编译；请在新版 min APK 安装后核对网页加载、登录、人工验证和流式回复。

独立 API 复用 Chat2API API Key（`Authorization: Bearer <key>`）。支持 `/v1/chat/completions`、`/v1/responses`、`/v1/images/generations`、`/v1/images/edits`、`/v1/images/upload`、`/v1/audio/generations`（音乐）、`/v1/video/generations`、`/v1/files`、`/v1/files/download?uri=...`、`/v1/chat/completions/with-file`。图片编辑和文件上传支持 `multipart/form-data`；上传也支持 JSON `data_base64`。图片/视频参考图可传 `ref_image_key`/`ref_image_keys`，媒体请求可用 `memory_type: 0/2` 或 `save_history: true/false` 控制是否留在官网历史。文件问答先上传文件，随后把响应 `uri` 作为 `file_id`，另传 `prompt`；不自动复用文件问答的官网会话。现有网页 TTS 走原语音服务。

任务运行时主 Chat2API 的豆包 LLM 也走该浏览器桥；任务停止后主 Chat2API 继续使用现有 Node 传输。任务页面或登录失败时会返回错误，不会在同一次请求中自动换传输。任务停止不清理专用 profile、账号或官网历史。所有官网能力还需登录后的真实账号和 Android 设备验收，接口测试只覆盖本地协议与资源生命周期。
