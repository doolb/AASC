# 豆包网页内置任务

## 签名保存与页面释放

普通Android Node会话成功签名会保存到Chat2API私有配置目录的 `doubao-signatures.json`。重启APK/Node后，同账号、同凭据及同权威会话可以复用；新聊天仍重新签名。签名不保证永久有效，发送失败且无正文/思考输出时仍最多重新签名补发一次。文件不含消息或Cookie头，不进入配置导出和Git。

控制端Chat2API面板增加“签名成功后关闭 WebView（Android 直连）”，默认关闭。通过当前AASC节点的WebSocket保存并同步；开启后在下次成功获取签名时销毁后台页面，保留Cookie，重签时重建；缓存命中不创建新页面。网页兼容模式及外部登录页保持运行。关闭能力需要新版min APK；当前min72不支持该能力，开启会提示更新。服务包及新版min APK待构建部署。

在任务面板启动“豆包网页” (`doubao.web`)。任务默认使用网页内 `fetch()`，桌面默认启动 `vivaldi`、本机调试端口 `9224`，兼容 API 默认监听 `127.0.0.1:9091`。可在任务参数中指定浏览器可执行文件、调试端口和唯一豆包账号 ID。桌面使用每个账号独立的 Chat2API profile；首次使用需在弹出的专用浏览器窗口登录豆包，验证码由用户在该窗口手动处理。任务不会自动删除官网会话或更换账号。

Android Offline 需配套包含本次修复的服务代码包与 min72 或更新的APK。外部网页登录后，在官网新会话发送一条自然消息并等待完整回复；采集成功会自动删除这次验证用临时会话，然后点“完成”保存。删除失败可点“完成”重试同一会话。已保存账号的Cookie、设备资料和当前网页UA会同步更新。

任务停止时走Node直连：隔离WebView在普通原生会话首轮生成官网签名，同账号、同凭据、同上游会话续聊在内存复用，消息由Node HTTP/2实际发送；任务运行时走网页兼容模式，由WebView发送并回传流。登录页关闭后，运行时会从已保存账号恢复Cookie和设备存储。登录与网页请求互斥，处理中重新打开登录页会提示稍后再试。新会话、凭据变化、进程重启或缓存淘汰后重新生成；发送失败且尚无正文或思考输出时，会清理缓存、重新签名并补发一次；两次共用原总时限，补发仍失败正常报错。用户取消、本地参数错误和已输出内容不补发。签名长期有效期未确认；其它不支持原生续聊的模式及无内部会话身份的请求仍逐条生成。

Note8已安装min72，使用隔离的最新Node源码、账号及任务目录验证了直连和兼容的Responses首轮与同会话续聊；正常服务仍为code148，本次服务代码包尚未构建发布。更新服务后请在正式账号入口重新完成一次登录验证。

独立 API 复用 Chat2API API Key（`Authorization: Bearer <key>`）。支持 `/v1/chat/completions`、`/v1/responses`、`/v1/images/generations`、`/v1/images/edits`、`/v1/images/upload`、`/v1/audio/generations`（音乐）、`/v1/video/generations`、`/v1/files`、`/v1/files/download?uri=...`、`/v1/chat/completions/with-file`。图片编辑和文件上传支持 `multipart/form-data`；上传也支持 JSON `data_base64`。图片/视频参考图可传 `ref_image_key`/`ref_image_keys`，媒体请求可用 `memory_type: 0/2` 或 `save_history: true/false` 控制是否留在官网历史。文件问答先上传文件，随后把响应 `uri` 作为 `file_id`，另传 `prompt`；不自动复用文件问答的官网会话。现有网页 TTS 走原语音服务。

任务运行时主 Chat2API 的豆包 LLM 也走该浏览器桥；任务停止后主 Chat2API 继续使用现有 Node 传输。任务页面或登录失败时会返回错误，不会在同一次请求中自动换传输。任务停止不清理专用 profile、账号或官网历史。所有官网能力还需登录后的真实账号和 Android 设备验收，接口测试只覆盖本地协议与资源生命周期。
