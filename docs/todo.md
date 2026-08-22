# Web MediaCenter - 未完成任务列表

## 聊天系统

- ✅已完成 [2026-08-22][2026-08-22] 服务器 TTS 按调用方检查显示端睡眠
  - 普通聊天、Agent、手动 TTS、提醒和语音指令不受睡眠模式影响；整点报时通过 `checkSleep=true` 按目标显示端状态跳过睡眠/深度睡眠设备
  - 改动：服务器 `sendToDisplay` 增加睡眠检查选项，任务引擎/旧报时路径传递检查参数，显示端移除通用 TTS 睡眠暂停和丢弃逻辑
  - 验证：TTS 睡眠策略 3 项、控制端协议 5 项、显示端睡眠集成 31 步通过
  - 文档：docs/design/display-sleep-mode.md、docs/spec/display-sleep-mode.md、docs/design/tts.md、docs/spec/tts.md、docs/task/2026-08-22_服务器TTS按调用方检查显示端睡眠.md

- ✅已完成 [2026-08-22][2026-08-22] 控制端聊天消息支持 Markdown 解析显示
  - 用户消息、普通 LLM、群聊、私聊和工作 AI 角色消息统一使用安全 Markdown 渲染器；输入框保持纯文本
  - 改动：`src/apps/web-mediacenter/ui/public/js/chat-markdown.js`、`src/apps/web-mediacenter/ui/public/js/chat.js`、`src/apps/web-mediacenter/ui/public/css/chat.css`、`src/apps/web-mediacenter/ui/public/upload.html`
  - 验证：Markdown 格式、原始 HTML 转义、危险链接过滤和前端加载顺序测试通过
  - 文档：docs/design/chat-system.md、docs/spec/chat-system.md、docs/task/2026-08-22_控制端聊天消息Markdown解析显示.md

- ✅已完成 [2026-08-21][2026-08-21] 修复控制端普通 LLM 流式消息不及时显示
  - 根因：普通 LLM 的 `chatChunk`/`chatResponse` 缺少 `requestId`，被控制端过滤
  - 改动：普通 `chatMessage` 将请求号传入 `handleChatMessage`，增量/成功/失败回包统一透传
  - 验证：流式请求号回归测试通过；AI 角色 service、handler、ClaudeBridge、role-store 测试通过；pipe-keeper 测试受沙箱 `mkfifo EPERM` 限制未能执行
  - 文档：docs/design/chat-system.md、docs/spec/chat-system.md、docs/task/2026-08-21_控制端LLM流式消息及时显示修复.md

## 开发工具

- ✅已完成 [2026-08-21][2026-08-21] 新增绕过 HTTPS 代理的服务器重启 npm 命令
  - 改动：Node 原生 HTTP/HTTPS 请求调用 `/api/restart`，默认地址可通过环境变量或命令行覆盖
  - 文档：docs/design/server-restart-script.md、docs/spec/server-restart-script.md、docs/task/2026-08-21_服务器重启命令脚本.md

## 媒体播放

- ✅已完成 [2026-08-20][2026-08-20] 音频媒体播放与睡眠批量手动切换
  - 改动：支持 WAV/OGG/MP3；贯通控制端、服务器、显示端与批量播放；控制端手动“下一个”触发临时激活，自动定时器睡眠拦截保持不变；实时同步当前文件名，控制端刷新后恢复批量文件名
  - 文档：docs/design/audio-media.md、docs/spec/audio-media.md、docs/task/2026-08-20_音频媒体播放与睡眠批量手动切换.md

- ✅已完成 [2026-08-21][2026-08-21] 媒体重连恢复播放进度
  - 改动：缓存并恢复 video/audio 单媒体进度；批量恢复当前索引、当前 video/audio 项进度及暂停状态；进度持久化增加节流与暂停/切项强制同步
  - 文档：docs/design/display.md、docs/design/audio-media.md、docs/design/batch-playlist.md、docs/spec/audio-media.md、docs/spec/batch-playlist.md、docs/task/2026-08-21_媒体重连恢复播放进度.md

- ✅已完成 [2026-08-22][2026-08-22] 显示端身份隔离与批量状态恢复
  - 服务器以稳定 `displayId` 持久化显示端设置和批量进度，旧 IP 状态首次连接时兼容迁移；Agent/测试端可用 `agent-local` 与真实显示端区分，控制端同时展示 ID 和 IP
  - 批量重连先恢复通用显示设置，再恢复列表索引、播放时间和暂停状态；控制端切换显示端时清空旧批量面板并按新显示端状态恢复
  - 控制端保存显示端选择模式、显示列表视图和最近选择的显示端 ID，显示端短暂断线重连后可恢复目标选择
  - 验证：新增回归 5 项；批量/音频/播放恢复/Agent/TTS 相关回归 40 项中 39 项通过，既有 display-native-bridge 原生触摸注入环境用例失败未涉及本次代码
  - 文档：docs/design/display.md、docs/design/batch-playlist.md、docs/spec/config.md、docs/spec/batch-playlist.md、docs/spec/display-selection.md、docs/task/2026-08-22_显示端身份与批量状态恢复.md

## AI 角色

- ✅已完成 [2026-08-22][2026-08-22] 修复控制端 Agent 流式消息显示并按普通 LLM 语义播报 TTS
  - 根因：Agent 启动状态广播 `roleList` 时重建整个聊天面板，移除了已创建的用户消息和流式回复节点，导致文字与用户消息等到完成回包才出现
  - 改动：聊天请求进行中只更新角色在线状态；Agent 的 `chatChunk` 继续实时更新回复，并沿用完整句子串行 TTS 队列及完成时尾句冲刷
  - 验证：AI Agent 控制端测试 4 项；AI 角色、Agent 后端、TTS、聊天流式相关测试串行 65 项全部通过
  - 文档：`docs/design/ai-roles.md`、`docs/spec/ai-roles.md`、`docs/task/2026-08-22_控制端Agent流式消息显示与LLM同构TTS.md`

- ✅已完成 [2026-08-22][2026-08-22] Agent 后端独立于服务器进程，修复服务器重启后控制端 Agent 离线
  - 新增 detached `agent-backend-host` 和 Unix Socket JSON Lines IPC；服务器仅保留 `AgentBackendClient`，不再直接持有生产 Agent 的 stdio/FIFO。
  - 服务器重启时复用后端宿主中的 Claude/Codex bridge、PID 和 Codex thread；Socket/宿主失效时自动拉起并允许下一次消息懒重建。
  - 验证：IPC 4 项、真实 Codex 进程重连、AI 角色服务 14 项、Claude/Codex/role-store/WS 相关 35 项及聊天/TTS/UI 回归通过。
  - 改动：`src/apps/server/modules/ai-roles/agent-backend-host.js`、`agent-backend-client.js`、AiRolesService、server-app、WS handler 及测试。
  - 文档：`docs/design/ai-roles.md`、`docs/spec/ai-roles.md`、`docs/task/2026-08-22_Agent后端独立于服务器进程.md`

- ✅已完成 [2026-08-22][2026-08-22] 修复 Codex 响应超时导致 Agent 离线
  - 改动：默认超时调整为 10 分钟；收到流式增量时重置无活动超时计时器；正常完成保持在线
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-22_Codex响应无活动超时修复.md

- ✅已完成 [2026-08-21][2026-08-21] 修复控制端 Agent 启动状态刷新和关闭按钮错误处理
  - 改动：Agent 启动成功立即广播在线状态；stop-all 状态查询不重新创建 bridge；前端检查 HTTP 响应并显示真实错误
  - 说明：Claude/Codex 当前自动通过权限审批并以高权限运行；聊天消息现由控制端共享 Markdown 渲染器显示
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端Agent在线状态与关闭错误修复.md

- ✅已完成 [2026-08-21][2026-08-21] 控制端关闭所有 Agent 与角色在线状态显示
  - 改动：系统设置新增关闭所有 Agent；服务端停止并清空 bridge、广播 roleList；角色 tab 显示在线/离线；不删除角色文件
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端关闭所有Agent与在线状态.md

- ✅已完成 [2026-08-21][2026-08-21] 控制端 AI 角色 Claude/Codex Agent 后端选择
  - 改动：聊天设置全局选择、默认 Codex、角色实际后端持久化、Codex app-server 持久 thread、Agent/LLM 消息区分；控制端 Agent 不进入 poll.js 任务队列
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端AI角色Agent后端选择.md

- [ ] Claude Code 本机代理恢复后，验证工作 AI 角色真实回复链路
  - 当前非交互 stream-json 启动已修复；验证时本机模型代理返回 HTTP 502，需代理恢复后复测

- ✅已完成 [2026-08-18][2026-08-18] 退出睡眠时视频检查控制端播放/暂停设置
  - 根因：resumeSleepMedia 无条件 mediaVideo.play()，忽略控制端暂停（单媒体无本地 isPlaying 跟踪，播放列表忽略 ps.paused）
  - 实现：新增 mediaIsPlaying（showMedia/handleControl play 同步）+ shouldPlayMedia（播放列表读 ps.paused）+ resumeSleepMedia 守卫
  - 验证：集成测试 30 步全绿（+3 步，真实 mp4）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-18_睡眠恢复检查播放状态.md
- ✅已完成 [2026-08-18][2026-08-18] 下发媒体取消手动覆盖（临时激活优先级高于 override）
  - 根因：activateTemporarily 只临时压过覆盖 60 秒，激活过期回落手动覆盖，下发媒体未真正取消覆盖
  - 实现：activateTemporarily 同时 manualSleepMode=null，媒体正常显示，过期按时段判定
  - 验证：集成测试 27 步全绿（步骤 13 改断言）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-18_下发媒体取消覆盖.md
- ✅已完成 [2026-08-17][2026-08-17] 睡眠模式视频未暂停修复（播放路径缺睡眠守卫）
  - 根因：document click 监听无守卫（display:block && paused 时点击即恢复视频）+ 空格/handleControl play/播放列表切播均无 isSleepPaused 守卫
  - 实现：display.html 四处统一加 isSleepPaused() 守卫（click/空格忽略、play 命令拒绝、playCurrentItem 不切播）
  - 验证：puppeteer 实测 click/空格/play 均保持 paused=true；集成测试 27 步全绿（+3 步）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-17_睡眠模式视频守卫.md
- ✅已完成 [2026-08-17][2026-08-17] 自动播报开关关闭后仍播报修复 + 开关持久化
  - 根因：服务端 setAutoTts 分支未转发显示端（只更新 time.announce），显示端 autoTtsEnabled 恒为 true
  - 实现：setAutoTts 补 sendToDisplay 转发 + 持久化 state.autoTts/updateDisplayState + 显示端 handleRestoreState 恢复
  - 验证：WS 实测转发日志 + config autoTts=True 持久化；集成测试 24 步全绿（+2 步）；附带修 display-sleep-mode 测试 h+1=24 clamp 时间敏感 bug
  - 文档：docs/spec/websocket.md、docs/design/display.md、docs/task/2026-08-17_自动播报开关修复.md
- ✅已完成 [2026-08-17][2026-08-17] http 媒体库支持获取文件大小 + 批量播放视频 seek
  - 实现：HttpProvider._fetchHead（HEAD 取 Content-Length/Last-Modified）+ getFile 填 size + list 并发补 size（小并发池 6）+ MediaLibraryManager.getFile 委托（修 proxy 端点 Range 恒回落 200 的静默 bug）
  - 验证：mnt 库 list 60 文件 56 个真实 size（0.36s）；库代理 Range 端到端 206 + Content-Range；播放列表 60 项全部同源代理 URL；11 个单测全绿
- ✅已完成 [2026-08-17][2026-08-17] HTTP 路径媒体无法播放修复（手动输入 http 地址 / http 媒体库被混合内容拦截）
  - 设计文档：docs/design/media-library.md（HTTP 媒体混合内容修复 + Range 流）
  - 实施计划：docs/task/2026-08-17_HTTP媒体混合内容修复.md
  - 实现：sendToDisplay 统一重写 http→/api/media-proxy（覆盖手动 URL/restore/单文件）+ 通用代理（流式+Range 透传+超时+SSRF 防护）+ HttpProvider 同源 HTTPS 库代理 URL + 库代理 Range + _fetchHtml 8s 超时（修 101 挂死）+ _parseHtml 垃圾条目过滤
  - 验证：Apache 日志 206 全量下载+分段续传（视频实际播放）；Range 透传 206；SSRF 403；垃圾条目 4→0；init 2.5s 内完成；8 个单测全绿
- ✅已完成 [2026-08-16][2026-08-16] Android 显示端 GPU Compute 桥（GLES 3.1 离屏计算）
  - 设计文档：docs/design/android-compute-bridge.md
  - 实施计划：docs/task/2026-08-16_android-gpu-compute桥.md
  - 实现：ComputeEngine.kt（离屏 EGL 3.1）+ ComputePixels.kt（像素翻转/通道）+ NativeBridge.compute() + JS NativeCompute 封装
  - 真机验证（三星 Note 8 / Android 9 / display 2）：数值翻倍 [2,4,6,8]、坏 shader 合法 JSON 错误、Float32Array 归一化、图像上下/红蓝正确
- ✅已完成 [2026-08-15][2026-08-15] Android APK 显示端（跨域控制增强）：WebView 包装 + 原生桥（真实像素截图 + 跨域输入注入），浏览器显示端保留并声明无跨域控制能力
  - 设计文档：docs/design/android-display.md
  - 实施计划：docs/task/2026-08-15_android-apk显示端.md
  - 实现：src/apps/android-display/（APK 工程）+ display.html 桥截图/输入链 + 能力声明 + 控制端提示
- ✅已完成 [2026-08-20][2026-08-20] APK 上传命令自动恢复服务器地址
  - `upload:apk` 安装后通过 Intent 注入 `https://192.168.1.39:8081`，APK 保存配置并自动连接。
  - 支持 `AASC_DISPLAY_SERVER_URL` 覆盖默认地址；覆盖冷启动和 `singleTask` 新 Intent。
  - 改动：`src/scripts/apk-deploy.js`、`src/scripts/apk-deploy-config.js`、`MainActivity.kt`、`ServerConfig.kt` 及对应测试/文档。
  - 真机验证（三星 Note 8 / Android 9，WebView 升级到 132 后）：
    - 跨域 html（example.com）原生截图稳定回传（1280x623，mode=native）
    - 无障碍真实触摸注入生效（InputDispatcher Delivering touch to WebView）
    - 能力声明 crossOriginControl:true 正常上报
    - 原生桥截图改同步返回（回调式在 WebView 不可靠）
- ✅已完成 [2026-08-16][2026-08-16] html 模式持久化 + 显示端自动刷新 + 控制端主动刷新/重载服务端 + 视频自动播放
  - html 滚动模式持久化到服务器，显示端重启后恢复
  - 显示端每 8 秒轮询 /api/display-version 自动 reload（无需重启 APK）
  - 控制端「刷新」按钮主动刷新显示端；系统设置「重载代码」按钮重启服务端
  - 视频自动播放 muted 绕过拦截（真机视觉待用户确认）
- ✅已完成 [2026-08-16][2026-08-16] render-display 覆盖层文字内嵌 + GPU/显存第二行
  - 设计文档：docs/design/render-display-inline-text.md
  - 实施计划：docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md
  - 实现：res/tasks/render-display/render.js（条内居中浮层文字、第二行 GPU/VRAM 占位对齐）
  - 验证：node render.smoke.js（结构校验）+ node --check
- ✅已完成 [2026-08-17][2026-08-17] 重构 ai 开发流程：文件驱动多 Agent 工作组（workgroup）
  - 设计文档：workgroup/docs/design.md
  - 实现文档：workgroup/docs/spec.md
  - 实现：workgroup/tools/（wg-core.js 纯函数 / wg-fs.js 文件系统 / poll.js 主入口）
  - 多独立 Claude 进程通过文件系统组队：main 分发、子 agent 自治轮询、history 历史画像

## Android APK

- [ ] 真机验证系统媒体播放器抢占音频焦点期间的 video/audio 暂停恢复，以及控制端手动暂停和睡眠模式拦截

## 批量播放模式

- ✅已完成 [2026-08-14][2026-08-14] 批量播放模式：媒体库文件夹级批量播放
  - 文件夹「批量播放」按钮 → 模式设置框（递归/间隔/顺序随机/排序/方向/循环/播报文件名）
  - 服务端 PlaylistManager 扫描生成列表一次性下发，显示端本地自循环播放
  - 进度回传 + 暂停/继续/上一个/下一个/停止干预，单文件播放打断批量
  - 临时模式裁剪区多文件/文件夹批量上传
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/playlist-app-service.js (新增)
    - tests/playlist-app-service.test.js (新增)
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/js/websocket.js
    - src/apps/web-mediacenter/ui/public/js/media-library.js
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - docs/design/batch-playlist.md (新增)
    - docs/spec/batch-playlist.md (新增)
