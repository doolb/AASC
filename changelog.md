# Web MediaCenter - 变更日志

## [Unreleased]

### 新增

- ✅ [2026-08-15] 新增 HTML 媒体类型
  - 媒体库识别 .html/.htm 文件为 html 类型；批量播放支持扫描 html 文件
  - 三个发送入口：媒体库文件点击（弹滚动设置）、媒体面板「发送 HTML」选择本地 .html 文件（临时发送或保存到媒体库）、裁剪框拖入 html 文件临时发送
  - 显示端 iframe 全屏纯展示（pointer-events: none，无裁剪），同源控制滚动
  - 滚动设置发送时选择：滚动方式（分页式每屏停 3/5/8 秒 / 平滑慢中快匀速）+ 循环播放独立开关（滚到底回顶继续，分页/平滑均可循环）；内容不足一屏不滚动
  - 批量播放 html 项按间隔切换（默认分页 5 秒），暂停冻结滚动、恢复继续
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/media-library-app-service.js
    - src/apps/web-mediacenter/modules/media/playlist-app-service.js
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - src/apps/web-mediacenter/ui/public/js/media-library.js
    - src/apps/web-mediacenter/ui/public/js/websocket.js
    - src/apps/web-mediacenter/ui/public/js/crop.js
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/css/display.css
    - src/apps/web-mediacenter/ui/public/upload.html
    - tests/media-library-app-service.test.js (新增)
    - tests/playlist-app-service.test.js
    - docs/design/html-media.md (新增)
    - docs/spec/media-library.md
    - docs/spec/batch-playlist.md
    - docs/task/2026-08-15_HTML媒体类型.md (新增)

- ✅ [2026-08-15] 显示端画面填充新增「铺满」模式（cover）
  - 媒体等比放大覆盖整个屏幕，超出部分居中裁切（旋转时自动计算方向）
  - 控制端显示控制/快捷控制面板新增「铺满」按钮
  - 改动文件：src/apps/web-mediacenter/ui/public/display.html、display.css、upload.html、docs/design/display.md

- ✅ [2026-08-14] 批量播放模式：媒体库文件夹级批量播放 + 临时模式批量上传
  - 媒体库文件夹项「批量播放」按钮 → 模式设置框（扫描范围递归/单层、间隔时间、顺序/随机、按文件名/按时间排序、正/反序、循环播放默认开、播报文件名默认关）
  - 服务端 PlaylistManager 扫描文件夹生成完整播放列表（Fisher-Yates 洗牌），一次性 playlistStart 下发显示端
  - 显示端本地自循环：图片按间隔切换、视频播完+间隔，循环回绕；上报 playlistProgress 进度，支持暂停/继续/上一个/下一个/停止/跳转干预
  - 单文件播放自动打断批量；非临时列表持久化到 config，显示端重连断点续播（resumeIndex）
  - 临时模式（base64 不落盘）裁剪区支持多文件/文件夹拖入，弹共用设置框后批量上传播放（总量 350MB 上限）
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

- ✅ [2026-07-05] Linux CPU 温度采集改用 sensors 命令（替代 thermal_zone 文件读取）
  - sensors -j 输出 JSON 更稳定，支持更多硬件平台
  - 优先取 Package id 0 封装温度，兜底取 Core 0 核心温度
  - 改动文件：
    - res/tasks/win-monitor/task.js

- ✅ [2026-07-05] Windows CPU 温度改用 systeminformation 库，GPU 采集增加功耗显示
  - Windows CPU 温度从 wmic 切换为 `si.cpuTemperature()`，更稳定准确
  - nvidia-smi 增加 power.draw 字段采集 GPU 功耗
  - render-display 仪表盘 GPU 圆圈中间显示功耗值（显存同行）
  - systeminformation require 失败时自动降级 wmic
  - 子显示端任务目录从 os.tmpdir() 改为 voice-display-node/run-task/，使 node_modules 可解析
  - 改动文件：
    - res/tasks/win-monitor/task.js
    - res/tasks/render-display/render.js
    - src/apps/voice-display-node/main.js
    - .gitignore
    - docs/spec/monitor-system.md
    - docs/design/monitor-system.md

- ✅ [2026-07-04] 任务状态卡片增加停止按钮、执行目标和模式显示
  - task-panel.js: _resultDetailHTML 添加目标(server/display/subdisplay)和模式(one-shot/service)显示
  - task-panel.js: 运行中/转发中的实例状态卡片添加停止按钮
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/task-panel.js

### 修复

- ✅ [2026-08-15] 修复 .mhtml 黑屏（显示端转换方案）
  - 根因：Chromium 内核（Chrome/Edge）对 .mhtml 渲染支持差，直接导航都 ERR_ABORTED，iframe 加载必然黑屏（Content-Type 修复无效）
  - 修复：显示端 html 分支检测 .mhtml URL → fetch 内容 → 前端 mhtmlToHtml 解析（multipart/related 分 part、base64/quoted-printable 解码、charset utf-8/gbk、资源引用重写为 data: URI，支持 cid: 引用）→ srcdoc 渲染
  - 验证：puppeteer 实测 — 标题正确、31/31 图片加载、scrollHeight 4008 可滚动
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/display.html
    - docs/spec/batch-playlist.md

- ✅ [2026-08-15] 修复 .mhtml 黑屏（Content-Type 为 octet-stream 浏览器不渲染）
  - 根因：express.static 对 .mhtml 返回 application/octet-stream，浏览器当二进制下载处理，iframe 黑屏
  - 修复：新增 staticWithMhtmlMime 静态路由 helper（.mhtml → Content-Type: message/rfc822），应用于 /uploads、媒体库静态路由、动态注册路由三处
  - 验证：MIME 逻辑模拟验证通过；浏览器实测需重启服务端
  - 改动文件：
    - src/apps/server/boot/server-app.js
    - docs/spec/media-library.md

- ✅ [2026-08-15] 修复 .mhtml 文件被识别为图片导致无法显示
  - 根因：`detectMediaType` 只识别 html/htm，.mhtml（单文件网页）被归为 image，点击后走图片流程，显示端 iframe 从未显示（保持 display:none）
  - 修复：服务端与上传端 detectMediaType 增加 mhtml → html（iframe 原生支持渲染 .mhtml）
  - 验证：新增 mhtml 识别测试，10/10 通过
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/media-library-app-service.js
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - tests/media-library-app-service.test.js
    - docs/spec/media-library.md

- ✅ [2026-08-15] 修复子目录媒体文件 404（html 显示白屏）
  - 根因：`LocalProvider.getPublicUrl` 用 `encodeURIComponent` 编码整个路径，`/` 被编成 `%2F`，express.static 不解码 encoded slash 返回 404；html 文件位于 uploads/html/ 子目录故白屏（图片/视频在子目录同样受影响）
  - 修复：路径按 `/` 分段编码（每段 encodeURIComponent，保留分隔符），uploads 与 /media/{id} 两个分支统一处理
  - 验证：新增 getPublicUrl 单测（断言不含 %2F），curl 实测 404 → 200
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/media-library-app-service.js
    - tests/media-library-app-service.test.js
    - docs/spec/media-library.md

- ✅ [2026-08-15] 修复整点报时「启用」开关设置后不生效
  - 根因：`TaskPanel._onWidgetSaveConfig` 收集 widget 字段时只处理 select/number，漏掉 checkbox，`enabled` 从不发送到服务端
  - 修复：补充 checkbox 收集（el.checked），并限定在容器内收集，避免多实例字段互相污染
  - 独立侧边栏面板（voiceService > 整点报时）：widget 渲染在 `#sidebar-widget-{taskName}` 容器，保存按钮渲染时替换为携带容器 id 的调用，任务面板与独立面板同时存在时各收集各的字段，互不干扰
  - 影响：time.announce 及所有自定义 widget 的 toggle 字段保存配置（任务面板 + 独立面板）
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/task-panel.js
    - src/apps/web-mediacenter/ui/public/js/sidebar-registry.js
    - docs/spec/remote-task-system.md

- ✅ [2026-07-06] 修复复合指令（chat-commands.json）天气查询携带完整历史记录
  - 根因：`executeCommands` 路径中 `onChat` 回调未传递 `skipHistory` 参数，导致复合指令展开的天气子查询走 `handleChatMessage` 时 `skipHistory=false`，把完整历史送入了 LLM 请求
  - 修复：`callbacks.onChat` 调用及 3 处 `onChat` 回调加上 `skipHistory` 参数并传入 `handleChatMessage`
  - 改动文件：
    - src/apps/web-mediacenter/modules/voice/voice-command-app-service.js
    - src/apps/server/boot/server-app.js

- ✅ [2026-07-05] 修复 render-display 覆盖层 90°/270° 旋转时三设备显示位置偏移
  - 根因：applyRotationStyle 使用固定 left:0/top:0（90°）和 right:0/bottom:0（270°），多设备时覆盖层过高，旋转后视觉左侧偏移屏幕外 / 左边间隔过大
  - 修复：根据 overlay.offsetWidth/offsetHeight 动态计算 left/top（90°）或 right/bottom（270°），确保旋转后视觉边缘距屏幕边缘 24px；每次 update() 都重算位置
  - 改动文件：
    - res/tasks/render-display/render.js
  - 文档更新：
    - docs/spec/monitor-system.md

- ✅ [2026-07-05] 服务任务断连改为 `display_offline` 状态，控制端显示"进行中(offline)"
  - 服务任务断开不再标记为 `failed`，改用 `display_offline`（可恢复态，非终态）
  - 控制端 UI 新增 `display_offline` 映射：状态显示"进行中(offline)"，橙色边框/标签
  - 新增 CSS 样式 `.display-offline`
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
    - src/apps/server/modules/task-engine/web-socket-handler.js
    - src/apps/web-mediacenter/ui/public/js/task-panel.js
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - docs/spec/remote-task-system.md

- ✅ [2026-07-05] 修复显示端断连后控制端任务状态不同步（显示端重启后任务仍显示"运行中"）
  - 根因：显示端 WebSocket 断开时 `onDisplayDisconnect` 仅记录日志，未清理该显示端上的运行中任务
  - 修复：TaskManager 新增 `handleDisplayDisconnect(displayId)` 方法
    - 遍历匹配 `targetInfo.displayId` 的 running/pending_forward 实例
    - 更新状态为 `failed`（原因：显示端已断开连接）
    - 通过 `result` 事件广播到控制端实时更新 UI
  - 服务模式任务自动恢复：断开时记录到 `_orphanedTasks`，重连后 `retryOrphanedTasks()` 自动 rerunInstance + runInstance（复用原 instanceId，不创建新实例）
  - 新增 `reforwardStaleDisplayTasks(displayId)` 显示端重连时扫描 `this.instances`，对修复前残留的 running/pending_forward 实例也重新转发
  - 修复 `runInstance` 中三个显示端转发路径未将 `pending_forward` 状态写入 index
    - 导致控制端早起连接时读到磁盘的旧 `running` 状态，显示"运行中"
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
    - src/apps/server/boot/server-app.js
    - docs/spec/remote-task-system.md

- ✅ [2026-07-04] 修复子显示端 task:progress 未触发任务链路由
  - 根因：web-socket-handler task:progress 分支直接 sendToControl 绕过 taskManager 事件系统，任务链路由不触发
  - 修复：改为 taskManager.emit('progress', ...)，由统一 handler 完成广播+路由
  - 改动文件：
    - src/apps/server/modules/task-engine/web-socket-handler.js

- ✅ [2026-07-04] 修复子显示端收到未知消息类型 task:renderUpdate
  - 修复：voice-display-node/main.js 添加静默忽略 case
  - 改动文件：
    - src/apps/voice-display-node/main.js

- ✅ [2026-07-04] 修复子显示端服务模式任务启动后前端显示自动完成
  - 根因：handleForwardResult 对显示端服务发出 result 事件（语义=任务完成），前端 _onResult 无条件将状态设为 completed
  - 修复：task-manager.js: 服务启动成功时不 emit('result')，服务仍在运行不应发送"完成"信号
  - 修复：task-panel.js: _onResult 检测 data.serviceStarted 标记，服务启动成功保持 running 状态
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
    - src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-06-24] 硬件监控系统 + 任务链机制
  - 新增：display.css .render-task-overlay 覆盖层样式
  - 文档：docs/design/monitor-system.md + docs/spec/monitor-system.md
  - 改动文件：
    - 新增：res/tasks/win-monitor/task.js
    - 新增：res/tasks/render-display/task.js
    - 新增：res/tasks/render-display/render.html
    - 新增：res/tasks/render-display/render.js
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：src/apps/web-mediacenter/ui/public/css/display.css
    - 修改：src/apps/voice-display-node/main.js
    - 新增：docs/design/monitor-system.md
    - 新增：docs/spec/monitor-system.md

- ✅ [2026-07-04] 任务面板增加任务链链接 UI
  - 新增：实例详情底部"链接到..."按钮，运行中实例可用
  - 新增：`_linkInstance()` 弹窗列出所有运行中实例，选择后发送 `task:link`
  - 新增：upload.css `.task-link-list`/`.task-link-item` 链接选择列表样式
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/task-panel.js
    - src/apps/web-mediacenter/ui/public/css/upload.css
  - 使用方式：在 win-monitor 实例详情页点"链接到..."，选择 render-display 实例即可绑定

- ✅ [2026-07-04] 任务链链接后数据未显示到 render-display
  - 修复：user service 上下文缺少 `sendProgress`，win-monitor 调用 `context.sendProgress()` 时 undefined
  - 修复：builtin service 上下文同样缺少 `sendProgress`
  - 修复：web-socket-handler 任务链路由只查 `targetInst.params._displayId`，但 displayId 存在 `targetInst.targetInfo.displayId` 中
  - 调整：render.html 黑底透明度 0.75→0.35
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
    - src/apps/server/modules/task-engine/web-socket-handler.js
    - res/tasks/render-display/render.html

### 修复

- ✅ [2026-07-04] render-display 需要适配显示端画面旋转
  - 新增：display.html `applyRotation()` 同步 `window.currentRotation`
  - 新增：render.js 读取 `window.currentRotation`，对 `#monitorOverlay` 做 `rotate(Ndeg)`
  - 调整：render.html 改为浮动面板（不再填满画面），仪表盘 180→260px，字体放大两倍
  - 调整：render.js 仪表盘字体 40→80px，标签 14→24px，弧线 14→18px，折线图尺寸增大
  - 调整：render.js 旋转适应改为 reposition + counter-rotate，各角度定位到对应角落
  - 调整：render.html `#monitorOverlay` 添加 `position:fixed`，自管理定位
  - 调整：display.css `.render-task-overlay` 移除 `top/right` 定位（由 overlay 自管理）
  - 调整：display.html 移除 render 覆盖层旋转（交由 render.js 自行处理）
  - 改动文件：
    - res/tasks/render-display/render.html
    - res/tasks/render-display/render.js
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/css/display.css
  - 修复：runInstance 中 `mode === 'service'` 判断优先于 `target === 'display'`，导致 service+display 任务被当作服务端服务执行
  - 修复：service 模式下先检查 target，若为 display/subdisplay 则转发到显示端而非在本进程运行
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
  - 修复：服务端 TTS handler 新增 `setAutoTts` 分支，路由到 TaskManager.handleWidgetAction 控制 time.announce 任务的 enabled 状态
  - 改动文件：
    - src/apps/server/boot/server-app.js
    - docs/spec/voiceCommand.md

- ✅ [2026-07-04] render-display 服务在控制端显示"已完成"（应显示"运行中"）
  - 修复：handleForwardResult 检测显示端服务（mode=service + target=display），转发成功后保持 status='running'
  - 新增：显示端服务注册到 _services，stop 时发送 {type:'task:stop', instanceId} 到显示端
  - 新增：display.html task:stop 消息处理，清理渲染覆盖层 DOM + 样式 + _renderTaskUpdates
  - 改动文件：
    - src/apps/server/modules/task-engine/task-manager.js
    - src/apps/web-mediacenter/ui/public/display.html
    - docs/spec/remote-task-system.md
    - docs/spec/monitor-system.md

- ✅ [2026-07-04] 语音显示端忽略静音指令，报时任务静音无效
  - 修复：voice-display-node `handleControl` 未处理 `volume` 动作，静音发送的 `{type:'control',action:'volume',value:0}` 被忽略
  - 修复：voice-display-node `playAudioFromURL` 未检查 `_volume`，静音状态下仍播报音频
  - 修复：语音命令"开启报时/关闭报时"仍走旧模块 `time-announce-app-service.setConfig`，无法控制 task 版报时的启用状态
  - 修复：注入 `setTimeAnnounceToggle`，路由到 TaskManager.handleWidgetAction 更新报时任务配置
  - 改动文件：
    - src/apps/voice-display-node/main.js
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/modules/voice/voice-command-app-service.js
    - docs/spec/voice-display.md

- ✅ [2026-06-24] 控制端任务面板无法选择一次性/服务模式
  - 修复：_runUserTask 硬编码 mode='one-shot', target='server' → 改为从 task 元数据读取
  - 修复：服务端 task:list 未解析 task.js 的 mode/target/entryFile → 新增解析并下发
  - 修复：编辑视图的 target/env/mode 按钮未根据 task 元数据预选中 → 新增 setActive 逻辑
  - 修复：新建任务面板模式按钮点击无效（事件冒泡冲突）→ 新增 stopPropagation + 独立 #modeGroup handler
  - 修复：_forwardToDisplay 只传了 task.js 没传 render.html/render.js → 改为传目录下所有文件

- ✅ [2026-06-21] 裁剪框旋转适配：修复旋转 90°/180°/270° 下拖拽和缩放的方向
  - 修复：旋转后拖拽裁剪框"左右移动变上下"问题
  - 修复：旋转后缩放手柄方向错误问题
  - 修复：旋转后手柄光标未跟随变化
  - 关键发现：updateBox 始终用 data.x→视觉横向、data.y→视觉纵向，
    因此拖拽用原始 dx/dy、缩放用原始 dx(东/西) dy(南/北)，无需旋转变换，
    手柄不随旋转重映射（始终控制相同视觉边缘）。
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/crop.js
    - docs/spec/upload.md

- ✅ [2026-06-19] 显示控制面板新增拖拽/粘贴上传，走临时模式
  - 裁剪预览区域 (#cropPreviewContainer) 支持拖入文件，display 面板可见时支持 Ctrl+V 粘贴（图片/视频）
  - upload.js 新增 sendTempFile() 复用 fileToBase64/getMediaDimensions/sendMedia 临时模式链路
  - temp 模式上传后本地 data URL 同步更新裁剪预览（不依赖服务器状态）
  - drag-over 状态虚线高亮边框
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - src/apps/web-mediacenter/ui/public/css/upload.css

- ✅ [2026-06-19] 上传新增临时模式：base64 中转，文件不保存到服务器磁盘
  - 控制端 upload.html 新增"临时模式"checkbox + 大小上限输入（默认 300MB）
  - control端 upload.js 新增 fileToBase64/getMediaDimensions，临时模式走 base64 WebSocket 发送
  - 服务端 WebSocket maxPayload 提升至 500MB，mediaBatch/media 处理增加 temp 标记跳过状态持久化
  - 显示端复用已有 type:'base64' 渲染分支，无需改动
  - 新增文档：docs/spec/upload.md
  - 改动文件：
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/ui/public/upload.html
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - docs/spec/upload.md

- ✅ [2026-05-30] 控制端裁剪框（crop.js）增加详细打印 + 修复刷新后裁剪框重置 Bug

- ✅ [2026-05-30] 控制端裁剪框（crop.js）增加详细打印 + 修复刷新后裁剪框重置 Bug
  - Bug：`showPreview()` 在媒体已缓存时，`onload` 事件和 `complete` 检查两条路径都会触发回调，
    第二次回调因 `_onReadyCallback` 为 null 调用 `recalculateSize(false)`，覆盖了从 `displayState` 
    恢复的裁剪数据（`savedCrop`），导致裁剪框刷新后显示全尺寸而非保存的裁剪状态
  - 修复：引入 `_callbackExecuted` 标志位，`executeCallback()` 包装函数确保回调只执行一次
  - 日志增强：`updateBox()` 打印 offset/百分比/像素值完整计算链；
    `recalculateSize()` 打印 `displayCanvasSize`、`aspectRatio` 比较过程和结果；
    `onMouseMove()` 打印拖拽/缩放的 delta/handle 映射/边界修正全过程；
    `showPreview()` 打印具体触发的路径（`onload`/`complete`/`readyState`）；
    `setData()` / `setRotation()` / `reset()` 分别添加入参和关键中间值日志
  - 改动文件：`src/apps/web-mediacenter/ui/public/js/crop.js`

- ✅ [2026-05-28] 日志上传到服务端时，控制端和显示端本地不输出到浏览器
  - 控制端：_installConsoleIntercept 中去掉 originalConsole.*.apply()，上传期间 DevTools 静默
  - 显示端：新增 applyLogReportConfig()，收到 logReportConfig 时覆盖 console.* 为空函数
  - 上传关闭时双方均恢复原始 console
  - 改动文件：
    - src/apps/web-mediacenter/ui/public/js/log-viewer.js
    - src/apps/web-mediacenter/ui/public/display.html

- ✅ [2026-05-28] 日志持久化到文件，保留最近 2 次启动记录
  - 新增 LogFileWriter：每次启动轮换 server.jsonl → server.1.jsonl
  - 订阅 logBuffer.onLogEntry，批量写入 JSON Lines 格式
  - 服务端、控制端、显示端日志统一保存到 logs/server.jsonl
  - 新增文件：src/framework/observability/log-file-writer.js
  - 改动文件：src/apps/server/boot/server-app.js

- ✅ [2026-05-28] 新增日志分类屏蔽配置，控制端可勾选不写入文件的分类
  - 黑名单模式：默认全部记录，勾选的分类被屏蔽
  - 新增 setLogBlocklist WS handler，服务端持久化到 config.json
  - logBuffer.onLogEntry 增加黑名单检查，命中则跳过写入
  - 服务端下发完整分类列表（合并 logBuffer 已有 + CATEGORY_DEVICE_MAP 全量）
  - upload.html 新增分类屏蔽 UI（清除屏蔽/屏蔽全部 + 逐类 checkbox）
  - log-viewer.js 新增 loadBlocklist / onBlocklistToggle / clearBlocklist / blockAll
  - websocket.js 新增 logBlocklist / logBlocklistApplied 消息处理
  - log-buffer.js 导出 CATEGORY_DEVICE_MAP 供服务端拼完整分类列表
  - 改动文件：
    - src/framework/observability/log-buffer.js
    - src/apps/server/modules/config/config-app-service.js
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/ui/public/upload.html
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - src/apps/web-mediacenter/ui/public/js/log-viewer.js
    - src/apps/web-mediacenter/ui/public/js/websocket.js

### 修复

- ✅ [2026-05-28] 修复控制端刷新后裁剪框显示位置与实际不一致
  - 根因：displayState 在 display 面板隐藏时到达，updateBox 因 getBoundingClientRect 为 0 跳过
  - 切换到 display 面板时未触发重新计算
  - switchPanel('display') 增加 Crop.updateContainerSize() + Crop.recalculateSize(false)
  - 改动文件：src/apps/web-mediacenter/ui/public/js/main.js

- ✅ [2026-05-28] 修复日志上传模式切换后未持久化到配置文件
  - 根因：setLogReport handler 仅更新内存 logReportStore，未调用 config.set() 落盘
  - config-app-service.js defaults 添加 logReportDisplay/logReportControl 默认值
  - server-app.js: logReportStore 初始化从 config.get() 加载已保存值
  - server-app.js: setLogReport handler 增加 config.set() 持久化调用
  - 修复 config 变量名与 destructure 冲突
  - 改动文件：
    - src/apps/server/modules/config/config-app-service.js
    - src/apps/server/boot/server-app.js

- ✅ [2026-05-27] 修复 3D 视图页签隐藏时 rAF 持续运算导致控制端卡顿
  - animate() 添加 document.hidden 检查，页签隐藏时跳过全量渲染
  - 使用 clock.getDelta() 消耗累积时间防止切回时跳帧
  - 修复 fetchAndDisplayActors() 未清理旧网格的内存泄漏
  - 新增 clearActorObjects() 精细化清理
  - 改动文件：src/apps/web-mediacenter/ui/public/viewer3d.html

### 优化

- ✅ [2026-05-27] 优化 3D 视图动画循环性能
  - Array.find() O(n²) 改为 buildingMap/actorMap 的 O(1) Map 查询
  - mesh.children.forEach 全遍历改为 torusMeshes Set 统一管理
  - 消除 actorMeshes 中 torus 旋转的冗余处理

### 移除

- ✅ [2026-05-27] 移除 TaskPanel 控制端 console.log/error 打印
  - 删除 task-panel.js 中 2 处 `console.log('[TaskPanel] ...')`（displayList 接收日志）
  - 注释掉 2 处 `console.error('[TaskPanel] ...')`（widget 脚本/初始化错误日志）
  - 改动文件：src/apps/web-mediacenter/ui/public/js/task-panel.js

### 新增

- ✅ [2026-05-24] 新增 webgpu-render 用户任务：显示端 WebGPU 渲染全蓝图片并持久化到服务端
  - 新建 res/tasks/webgpu-render/task.js：用户任务，包含 WebGPU 渲染逻辑 + params + widget
  - display.html executeTask() 新增 env=webgpu/webgl 检测，GPU 任务跳过 Worker 直接主线程执行
  - display.html 移除硬编码的 executeWebGpuRender() 及相关 builtin dispatch
  - 删除 builtin-tasks/webgpu-render.js（改为用户任务方式）
  - task-io.js 新增 saveOutputFiles() 方法持久化显示端输出文件
  - task-manager.js handleForwardResult() 调用 saveOutputFiles() 写入实例目录
  - 显示端不硬编码渲染逻辑，只提供 GPU 主线程执行环境
  - 参数：width（640）、height（480）
  - 改动文件：
    - 新增：res/tasks/webgpu-render/task.js
    - 新增：docs/spec/webgpu-render.md
    - 删除：src/apps/server/modules/task-engine/builtin-tasks/webgpu-render.js
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/registry.js
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：src/apps/server/modules/task-engine/task-io.js
    - 修改：src/apps/server/modules/task-engine/task-manager.js

### 修复

- ✅ [2026-05-24] 修复控制端切换任务实例时状态错误显示为"已完成"
  - _onInstanceLogs 创建新条目时不再硬编码 status:'completed'，改为从 taskList 查找实际状态
  - _renderInstancesCol/_showResultsView 合并内存状态时增加 null 守卫，防止 undefined 覆盖真实状态
  - _handleTaskList 增加服务端状态回写内存，确保每次刷新后非运行中实例状态以服务端为准
  - _selectInstance 增加 _requestTaskList()，切换实例时主动拉取最新数据
  - 移除所有调试打印（[RERUN] 日志、_debug/_log 系统、3s 轮询）
  - 改动文件：task-panel.js

- ✅ [2026-05-24] 修复 stopInstance 对内存中不存在的孤儿实例不更新 index.json
  - stopInstance() 增加回退到 index.json 查找并更新状态的逻辑
  - runInstance() 中内置任务执行后增加 stopped 状态检查，防止 _handleResult 覆盖 stop 状态
  - task-panel.js _onStopped 增加 _requestTaskList() 刷新控制端任务列表显示
  - 改动文件：task-manager.js、task-panel.js

### 新增

- ✅ [2026-05-24] llm-chat 新增 promptFormat/contextCount/maxTokens/apiKey 参数，支持 raw 消息格式
  - params 扩展为 9 个字段（+promptFormat/contextCount/maxTokens/apiKey）
  - widget 增加 promptFormat 输入框
  - run() 支持 promptFormat=raw 纯文本格式（System:/User:/AI:）
  - 请求体加入 max_tokens 字段，支持 apiKey 鉴权头
  - 迁移 config.json 中 3 个 profile 为 llm-chat 实例（default/glm4.7-free/qwen3.5）
  - 改动文件：llm-chat.js、res/tasks/llm.chat/results/index.json

- ✅ [2026-05-24] llm-chat 重构：实例 params 存配置，全局配置通过 task:set_config 管理

- ✅ [2026-05-24] 修复 rerun 无响应：前端乐观更新 + 服务端加打印
  - 前端 _rerun_result 处理器改为无条件乐观更新实例状态为 draft 并立即重绘
  - 服务端 web-socket-handler 增加 rerun_result/error 打印日志
  - 改动文件：task-panel.js、web-socket-handler.js

- ✅ [2026-05-24] 修复 llm-chat 重新执行无响应 — _renderResultCol 缺少 status 合并
  - _renderResultCol 内存状态合并新增 `if (memInst.status) inst.status = memInst.status`
  - 改动文件：task-panel.js

- ✅ [2026-05-24] llm-chat widget 也从 index.json 读取已保存参数
  - llm-chat.js widget HTML 6 处硬编码 value 改为 {{var}} 占位符
  - task-panel.js _renderWidget 移除 !widgetDef.script 条件，始终执行 {{var}} 替换
  - 改动文件：llm-chat.js、task-panel.js

- ✅ [2026-05-24] test-echo 用户任务增加 params/widget，widget 从 index.json 读取已保存参数（无需轮询）
  - task.js widget HTML 使用 {{message}}/{{count}} 模板占位符替代硬编码 value
  - task-panel.js _resultDetailHTML：合并 inst.params + PARAMS 默认值到 _widgetData
  - task-panel.js _saveWidgetParams：乐观更新本地数据 + 立即重绘 widget
  - task-panel.js _renderResultCol：合并 memInst.params 到 inst.params
  - task-panel.js handleMessage：新增 task:instance_params_updated 触发 widget 重绘
  - res/tasks/test-echo/task.js 增加 params（message、count）和 widget export
  - web-socket-handler.js task:list 分支中 require task.js 获取 params + widget 注入返回
  - 新增 docs/spec/test-echo.md 伪代码文档
  - 改动文件：res/tasks/test-echo/task.js、src/apps/server/modules/task-engine/web-socket-handler.js、docs/spec/test-echo.md

- ✅ [2026-05-23] 删除 tts.js 中整点报时死代码（loadTimeAnnounceConfig / saveTimeAnnounceConfig）— 报时已改为内置任务管理
  - 删除 timeAnnounceConfig 默认值、loadTimeAnnounceConfig、renderTimeAnnounceConfig、saveTimeAnnounceConfig
  - 删除对应的全局绑定 window.saveTimeAnnounceConfig
  - 改动文件：src/apps/web-mediacenter/ui/public/js/tts.js

- ✅ [2026-05-23] TaskPanel 控制端日志分级开关 — 7 处 console.log 改为 _log(cat, ...)，按种类分 5 个开关
  - 新增 _debug 对象（init/polling/ws/displayList/message）
  - 新增 _log(cat, ...) 统一日志入口
  - 保留 3 处 console.error 不变
  - 改动文件：src/apps/web-mediacenter/ui/public/js/task-panel.js
  - 文档：docs/spec/remote-task-system.md 新增"控制端调试日志"章节

- ✅ [2026-05-17] 任务系统草稿模式 — 所有实例从 draft 开始，rerun 重置同实例
  - submit() 始终返回 draft，不再检查 autoRun
  - 新增 runInstance() 独立执行方法（draft → running → completed/failed）
  - 新增 rerunInstance() 将 completed/failed/stopped 重置为 draft（同实例不克隆）
  - 新增 task:rerun WebSocket 消息，移除 autoRun 概念
  - 前端适配：draft 状态图标/文本、rerun 按钮替代重新执行
  - 服务重启恢复：restoreAutoStartServices() 改为 submit → runInstance 两步
  - 前置逻辑从 web-socket-handler 迁移到 task-manager 内部（_forwardToDisplay）
  - 向后兼容：task:run 同时接受 draft 和 created 状态
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 新增：docs/design/task-system-draft-mode.md
    - 新增：docs/task/2026-05-17_task-system-draft-mode.md
    - 修改：docs/spec/remote-task-system.md

- ✅ [2026-05-17] llm.chat widget script 化，消息/保存逻辑内聚到 script 中
  - widget 由 onclick 外联改为 script 模式，发送/保存按钮用 class 绑定
  - task-panel.js 移除 _submitChatMessage / _saveWidgetGlobalConfig 任务特有代码
  - _initWidgetController 增加 api.taskName + api.submitTask 通用能力
  - _renderWidget 修复 template 替换（script 模式下也替换 {{instanceId}}/{{taskName}}）
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-17] llm.chat 消息输入框 + 流式输出支持

### 修复

- ✅ [2026-05-17] completed 状态的实例在结果详情中显示配置面板 widget
  - _resultDetailHTML 中增加 completed 状态渲染 widget
  - _renderWidget 增加 taskName 参数和 {{taskName}} 模板变量
  - _saveWidgetGlobalConfig 修复 DOM 选择器，同时覆盖任务面板和侧边栏
  - llm-chat.js widget 按钮改为传 taskName（修复保存全局默认写入目标）
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js

- ✅ [2026-05-17] llm.chat 改为 one-shot 任务，Widget 始终显示参数面板
  - llm.chat 从 mode=service 改为 mode=one-shot，run() 直接接收 messages 参数调用 LLM API 返回结果
  - 移除 service 专用逻辑（widget action 注册、postWidgetUpdate、postStream、停止按钮等）
  - Widget HTML 改用硬编码默认值（不再依赖 {{var}} 实时推送），未运行时参数面板始终可见
  - 新增 TaskPanel._saveWidgetGlobalConfig() 支持 one-shot 任务保存全局配置
  - 已创建的实例（status=created）在结果详情中显示 widget 参数面板，可编辑后直接运行
  - 前端内置任务选择时自动匹配执行模式
  - 回滚 task-manager.js 中 builtin 分支的服务路由检测（llm.chat 已非服务）
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/llm-chat.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-17] 修复内置服务任务因 taskType 传错为 'user' 导致"入口文件不存在"错误
  - 服务端 TaskManager.submit() 新增内置任务自动检测：当任务名匹配内置注册表时自动修正 taskType/builtinId
  - 前端 _runUserTask() 检测内置任务后切换为 _runBuiltin 路径
  - 前端 _runEditTask() 根据 taskType 发送正确的任务类型和 builtinId
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-17] 修复实例名字在 Web UI 中被截断显示不全
  - 实例历史列表：从截断 6 字符改为显示完整实例名，添加 title 悬浮提示
  - 结果详情视图：从截断 8 字符改为显示完整实例名，添加 title 悬浮提示
  - 运行中监控卡：从截断 8 字符改为显示完整实例名，添加 title 悬浮提示
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 显示端重连后 displayId 变导致任务结果记录引用失效
  - 浏览器显示端（display.html）改用 localStorage 持久化 displayId，重连时作为 URL 参数传递
  - 服务端已支持自定义 displayId 参数，无需改动
  - 子显示端（voice-display-node）配置已有固定 displayId，不受影响
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：docs/spec/websocket.md

- ✅ [2026-05-16] 长任务阻塞：服务端异步派发 + 显示端 Web Worker 隔离
  - 服务端：NodeJsRunner/PuppeteerRunner 改为异步派发，submit() 立即返回，结果通过事件广播
  - 显示端：用户任务改用 Web Worker 隔离执行，主线程不再被用户代码阻塞
  - 显示端：Web Worker 添加 30 秒超时保护，防止死循环任务永久挂起
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：docs/spec/remote-task-system.md

### 新功能

- ✅ [2026-05-16] 服务任务生命周期 + 整点报时内置服务
  - 新增 _runServiceTask() 在主进程运行服务任务，不 fork
  - 支持内置服务（builtinRegistry.run）和用户上传服务（require）
  - stopInstance() 检测服务控制器，调 controller.stop() 停止
  - 用户上传服务清理 require 缓存，支持重新上传
  - 常驻改名为服务，默认入口文件 service.js
  - 新增整点报时内置服务 time.announce（mode: service）
    - 主进程运行，监听 timeListener 分钟变化
    - 到整点/半点/刻钟时生成 TTS，广播到所有显示端
    - 支持间隔、重复次数、启用/禁用配置
  - 内置任务列表增加 target / mode 字段
  - 控制端服务任务卡片显示"启动"按钮
  - 控制端服务任务显示"停止"按钮（自动适配 running 状态）
  - 注入 sendToDisplay / broadcastToDisplays 到服务上下文
  - 服务任务自动启动：启动的服务持久化到 config，服务器重启时自动恢复
  - 服务停止时自动从自动启动列表移除

- ✅ [2026-05-16] Widget 系统：服务任务控制端自定义 UI
  - 内置任务可定义 widget（fields / displays / actions）
  - task:widget_update 实时推送状态到控制端
  - task:widget_action 控制端动作路由到服务处理器
  - 控制端 widget 渲染引擎：toggle / select / number 字段 + 实时数据显示 + 动作按钮
  - widget 支持自定义 script 控制器（new Function 沙箱执行）
    - api.onUpdate(fn) — 数据驱动渲染，每次 widget_update 调用
    - api.sendAction(action, params) — 发动作到服务端
    - api.getContainer() / api.getData() — 访问 DOM 和数据
    - api.setInterval(fn, ms) — 安全定时器，自动清理
    - api.onDestroy(fn) — 清理回调
  - 整点报时接入 widget：配置表单 + 上次/下次报时 + 测试报时按钮 + 保存配置
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/time-announce.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：docs/spec/remote-task-system.md
  - 改动文件：
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 新增：src/apps/server/modules/task-engine/builtin-tasks/time-announce.js
    - 修改：src/apps/server/modules/task-engine/builtin-tasks/registry.js
    - 修改：src/apps/server/boot/server-app.js
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：docs/spec/remote-task-system.md
    - 修改：docs/design/remote-task-system.md
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：docs/spec/websocket.md

### 新功能

- ✅ [2026-05-16] 任务列表界面重新设计为三列布局
  - 左列：任务列表（内置任务 + 用户任务），点击卡片选中
  - 中列：选中任务的执行记录列表
  - 右列：选中执行记录的详情（日志、结果、操作按钮）
  - 任务卡片去除"结果"按钮（被中列和右列替代），新增选中态样式
  - 新增 _selectTask / _selectInstance / _renderInstancesCol / _renderResultCol / _switchToNew
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：src/apps/web-mediacenter/ui/public/css/upload.css

### 新功能

- ✅ [2026-05-16] 添加测试用户任务 test-echo，用于验证任务系统端到端流程
  - 接收任意 params 参数，原样输出到日志和结果
  - 存放于 res/tasks/ 用户任务目录
  - 改动文件：
    - 新增：res/tasks/test-echo/task.js
    - 文档：docs/task/2026-05-16_测试用户任务.md

- ✅ [2026-05-16] 用户任务卡片增加快捷运行按钮，支持一键提交默认配置任务
  - 新增 _runUserTask() 方法，根据任务信息自动填充 task:submit
  - 用户任务卡片操作栏新增 primary 样式"运行"按钮
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 编辑任务视图增加运行按钮，支持编辑时携带参数提交运行
  - 新增 _runEditTask() 方法，读取 editParams 参数后提交 task:submit
  - 编辑视图操作栏新增运行按钮（与保存修改并列）
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 任务 index.json 改用 DataSnapshot 自动加载保存
  - 新增 TaskIndex extends DataSnapshot 管理实例索引
  - TaskIO 缓存每个任务的 DataSnapshot 实例，修改索引属性自动持久化
  - 修复 DataSnapshot 缺失 _proxyCache 初始化导致嵌套对象访问崩溃的 bug
  - 改动文件：
    - 新增：task-io.js TaskIndex 类
    - 修改：task-io.js getIndex/updateIndex/deleteInstance/cleanupOldInstances
    - 修改：core/data-snapshot/DataSnapshot.js 增加 _proxyCache 初始化

- ✅ [2026-05-16] 显示端任务执行捕获 console.log 并回传日志
  - display.html executeTask 拦截 console.log/error/warn 采集到 taskLogs
  - task:result 消息新增 logs 字段携带捕获的日志
  - 服务端收到后写入 run.log 并广播 task:log 到控制端
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/display.html
    - 修改：web-socket-handler.js

- ✅ [2026-05-16] 修复显示端任务转发失败时卡住的问题
  - 转发时检测 sendToDisplay 返回值，发送失败立即回调失败结果
  - 转发任务增加 30 秒超时，超时自动标记失败
  - 改动文件：
    - 修改：web-socket-handler.js
    - 修改：task-manager.js

- ✅ [2026-05-16] 修复显示端执行用户任务报 module is not defined
  - 浏览器无 CommonJS 环境，执行前 strip module.exports 语句
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/display.html

- ✅ [2026-05-16] 修复快捷运行时用户任务转发到显示端执行失败（files 为空）
  - 转发时若 files 为空，自动从磁盘读取任务文件内容补上
  - 新增 TaskIO.readTaskFiles() 读取任务目录文件为 base64
  - 改动文件：
    - 新增：task-io.js readTaskFiles 方法
    - 修改：web-socket-handler.js 转发时自动补文件

- ✅ [2026-05-16] 修复用户任务转发到显示端执行失败（缺少 entryFile 和 files）
  - task:execute 转发负载补充 entryFile 和 files 字段
  - 改动文件：
    - 修改：web-socket-handler.js

- ✅ [2026-05-16] 修复 run.log 日志顺序混乱问题
  - _handleResult 中 Promise.all 并行写入改为顺序 await，保证日志按产生顺序落盘
  - 改动文件：
    - 修改：task-manager.js

- ✅ [2026-05-16] 点击编辑切换到新建任务页签显示编辑视图
  - _viewEdit 切到新建任务 tab 再渲染编辑表单，不影响三列列表布局
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 编辑任务视图运行支持选择目标/环境/模式和设备
  - 编辑视图执行配置区增加目标、环境、模式按钮组和设备选择器
  - _runEditTask 读取 editTargetGroup/editEnvGroup/editModeGroup/editDeviceSelectorList
  - 新增 _renderEditDeviceSelector() 复用 _renderDeviceSelector
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 执行结果面板支持单独删除某条执行记录和重新执行
  - 结果详情底部新增"重新执行"按钮，复用原 instanceId 覆盖执行记录
  - 服务端 task:submit 支持可选 instanceId 参数
  - index 存储 target/env/mode/displayId 字段，重新执行时读取原配置
  - 改动文件：
    - 修改：task-manager.js submit 支持 optional instanceId
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
  - 服务端新增 task:delete_instance WS 消息，删除实例目录和索引
  - TaskIO.deleteInstance 删除实例目录、更新索引和 latest 符号链接
  - TaskManager.deleteInstance 清理内存和子进程
  - 前端结果历史侧栏每条加 hover 显示的 ✕ 删除按钮
  - 前端结果详情底部加"删除此执行记录"按钮
  - 新增 CSS .task-result-history-del 样式
  - 改动文件：
    - 新增：task-io.js deleteInstance 方法
    - 新增：task-manager.js deleteInstance 方法
    - 修改：web-socket-handler.js task:delete_instance 消息处理
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：src/apps/web-mediacenter/ui/public/css/upload.css

- ✅ [2026-05-16] 修复打开结果时大量重复 task:get_instance_logs 请求的死循环
  - 根因：run.log 为空时日志数组为空，触发重复请求
  - 在实例上标记 _logsLoaded，请求前检查避免重复
  - 改动文件：
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

- ✅ [2026-05-16] 修复控制端任务结果视图不显示日志的问题
  - 新增 task:get_instance_logs WebSocket 消息类型，服务端读取 run.log 返回
  - 新增 TaskIO.readInstanceLog() 方法读取磁盘日志文件
  - 新增 TaskManager.getInstanceLog() 方法（内存回退+磁盘读取）
  - 前端新增 _onInstanceLogs / _requestInstanceLogs，结果视图自动请求并解析日志
  - 改动文件：
    - 新增：task-io.js readInstanceLog 方法
    - 修改：task-manager.js getInstanceLog 方法
    - 修改：web-socket-handler.js task:get_instance_logs 消息处理
    - 修改：src/apps/web-mediacenter/ui/public/js/task-panel.js

### 新功能

- ✅ [2026-05-13] 远程任务系统：控制端上传 JS 代码，选择服务端/显示端/子显示端执行
  - 支持三种执行运行时：Node.js（CPU）、Puppeteer（WebGL/WebGPU）、浏览器原生
  - 支持一次性任务和常驻任务，按实例 ID 并行管理
  - 内置任务注册表，系统功能可拆为可复用任务模块
  - 实时日志流推送 + 持久化 run.log
  - 跨任务文件引用（context.refs 路径映射）
  - 实例自动清理（保留最近 50 个）
  - 改动文件：
    - 新增：src/apps/server/modules/task-engine/task-io.js, nodejs-runner.js, puppeteer-runner.js, task-manager.js, web-socket-handler.js
    - 新增：src/apps/server/modules/task-engine/builtin-tasks/registry.js, image-resize.js
    - 新增：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 修改：src/apps/server/boot/server-app.js
    - 修改：src/apps/web-mediacenter/ui/public/upload.html, display.html
    - 修改：src/apps/voice-display-node/main.js
    - 文档：docs/design/remote-task-system.md, docs/spec/remote-task-system.md

- ✅ [2026-05-14] 控制端任务面板重新设计：三标签导航、设备选择器、编辑、结果查看
  - 分层标签式布局：任务列表 / 新建任务 / 运行监控
  - 任务列表：内置任务/用户任务分组，卡片式展示，搜索筛选
  - 新建任务：按钮式配置选择，设备选择器实时展示在线设备
  - 运行监控：实时日志、进度条、计时器、任务迁移
  - 编辑任务：文件替换/新增/删除，配置修改
  - 查看结果：执行历史列表，输出文件预览/下载，日志查看
  - 服务端新增 API：task:list / task:update / task:delete
  - 改动文件：
    - 重构：src/apps/web-mediacenter/ui/public/js/task-panel.js
    - 重构：src/apps/web-mediacenter/ui/public/css/upload.css (task 部分)
    - 修改：src/apps/server/modules/task-engine/task-io.js
    - 修改：src/apps/server/modules/task-engine/task-manager.js
    - 修改：src/apps/server/modules/task-engine/web-socket-handler.js
    - 新增：docs/superpowers/specs/2026-05-14-task-panel-redesign.md
  - 设计文档：docs/superpowers/specs/2026-05-14-task-panel-redesign.md
  - 实现文档：docs/spec/remote-task-system.md

- ✅ [2026-05-12] 私聊添加多会话支持，控制端下拉切换
  - 同一助手下可创建多个独立会话，每个会话有独立的聊天上下文和历史记录
  - 消息记录新增 sessionId 字段，会话键改为 private:{target}:{sessionId}
  - 服务端新增 session CRUD（list/create/delete/switch），支持 WebSocket + HTTP API
  - 控制端聊天头部新增会话下拉选择器，支持新建/删除/切换会话
  - 向后兼容旧消息（无 sessionId 归入 default 会话）
  - 改动文件：llm-service.js, server-app.js, chat.js, websocket.js, chat.css
  - 设计文档：docs/design/private-chat-sessions.md
  - 实现文档：docs/spec/chat-system.md

### Bug 修复

- ✅ [2026-05-12] 天气指令路由到 LLM 时默认城市丢失，LLM 误识别为上海
  - 原因：`checkCommandRouting()` 剥离时间词（今天/明天/后天）且 fallback 硬编码"查询今天的天气"，未使用 `defaultWeatherCity`
  - 修复：只剥离"天气"和末尾标点，保留时间词；检测文本中是否包含已配置城市，缺失时插入 `defaultWeatherCity`
  - 效果：`"明天天气"` → `"查询成都明天的天气"`，时间正确、城市正确
  - 改动文件：voice-command-app-service.js, docs/spec/voiceCommand.md
  - 同一助手下可创建多个独立会话，每个会话有独立的聊天上下文和历史记录
  - 消息记录新增 sessionId 字段，会话键改为 private:{target}:{sessionId}
  - 服务端新增 session CRUD（list/create/delete/switch），支持 WebSocket + HTTP API
  - 控制端聊天头部新增会话下拉选择器，支持新建/删除/切换会话
  - 向后兼容旧消息（无 sessionId 归入 default 会话）
  - 改动文件：llm-service.js, server-app.js, chat.js, websocket.js, chat.css
  - 设计文档：docs/design/private-chat-sessions.md
  - 实现文档：docs/spec/chat-system.md

### 优化

- ✅ [2026-05-11] 天气/搜索指令路由到 LLM 时跳过聊天上下文
  - `checkCommandRouting()` 返回值增加 `skipHistory` 标记
  - `handleChatMessage()` 检测 `skipHistory` 后强制 `includeHistory=false`
  - 系统指令（天气/搜索）走 LLM 时不再携带聊天历史，节省 token 并避免干扰
  - 改动文件：voice-command-app-service.js, server-app.js
  - 实现文档：docs/spec/voiceCommand.md

### 新功能

- ✅ [2026-05-10] display.html 增加 WebGPU 支持检测，WebGL 拆分为 1.0/2.0 独立检测
  - `getFeatureSupport()` 新增 WebGPU 条目，检测 `navigator.gpu` 是否存在
  - WebGL 拆分为 WebGL 1.0 和 WebGL 2.0 分别检测，提高精度
  - 控制端 `DisplayList.showFeatureModal()` 自动展示该信息
  - 改动文件：display.html

### 修复

- ✅ [2026-05-10] 修复群聊模式下保留上下文条数配置不生效的问题
  - `handleChatMessage()` 中当 `templateTarget` 存在且为群聊模式时，未读取 `config.contextCount`，导致 `includeHistory` 始终为 `false`
  - 前端群聊始终默认携带 `templateTarget`（第一个模板名），导致此问题每次触发
  - 改动文件：server-app.js
  - 实现文档：docs/spec/chat-system.md

### 新功能

- ✅ [2026-05-10] LLM 历史消息超出 maxTokens 时自动截断
  - `buildMessages()` 按 maxTokens 作为上下文上限，自动截断历史
  - 超出时从最旧的 user/assistant 消息开始删除，直到总 token 数不超出
  - 改动文件：llm-service.js

- ✅ [2026-05-09] 支持 LLM 纯文本 prompt 格式
  - `llmProfiles` 新增 `promptFormat` 字段：`'messages'`（标准格式）或 `'raw'`（纯文本）
  - `buildMessages()` 根据 `promptFormat` 选择输出格式
  - raw 格式: `System:...\nUser:...\nAI:...` 单条 user 消息
  - 改动文件：llm-service.js, config-app-service.js

### 修复

- ✅ [2026-05-09] 修复 LLM 请求中用户消息重复的问题
  - `addMessage()` 先存入用户消息 → `buildMessages()` 从历史取出后又追加一次
  - `buildMessages()` 取历史时自动排除最后一条 user/control 消息（即当前查询）
  - 改动文件：llm-service.js

- ✅ [2026-05-09] 聊天历史内存与文件均按会话分离
  - `chatHistory` 单一数组 → `chatHistories` 按 sessionKey 分组的 Map
  - `buildMessages()` 直接读取对应会话的历史，无需过滤
  - 群聊消息 → `chat-history.json`, 私聊角色 X → `chat-history-X.json`
  - 每个会话独立截断（最多 100 条/会话）
  - 改动文件：llm-service.js
  - 实现文档：docs/spec/chat-system.md

- ✅ [2026-05-09] 修复私聊时 LLM 历史消息混入其他角色对话的问题
  - `buildMessages()` 未按 `mode`/`target` 过滤 `chatHistory`，导致妲己的对话历史中混入小爱、千问等角色的消息
  - 改为先按会话过滤（私聊按角色名、群聊排除私聊），再取最近 N 条
  - 改动文件：llm-service.js, server-app.js, agents/index.js
  - 实现文档：docs/spec/chat-system.md

- ✅ [2026-05-09] 修复 LLM 流式响应分句逻辑——解决快速响应时多句合并问题
  - `findLastSentenceBoundary()` 只找最后一个分句边界，导致多个完整句子被合并发出
  - 改为用 `splitIntoSentences()` 提取所有完整句子，保留末尾不完整片段
  - 改动文件：llm-service.js
  - 实现文档：docs/spec/chat-system.md

- ✅ [2026-05-09] 修复引号字符被误判为句末标点导致 TTS 失败
  - `isSentenceEnd()` 的 `endChars` 包含 `"`、`"`、`'`、`'` 等引号字符
  - LLM 输出带引号内容时（如 `第一句是"你好"`）在引号处错误分句
  - 移除 `endChars` 中所有引号字符
  - 改动文件：llm-service.js

- ✅ [2026-05-09] 逗号累积超过4个时自动分句，避免过长文本一次送入 TTS
  - `splitIntoSentences()` 新增 commaCount 计数，达到4个 `，`/`,` 时强制切分
  - 改动文件：llm-service.js

- ✅ [2026-05-09] 修复网页端聊天回复换行 \n 被丢弃
  - `chat-message-content` 缺少 `white-space: pre-wrap`，HTML 渲染时折叠了换行
  - 改动文件：chat.css

- ✅ [2026-05-09] 修复英文句点 `.` 误切分小数点（如 `1062.40` 被拆成两句）
  - `splitIntoSentences` 对 `.` 增加后视检查：后跟空格/换行/结尾才视为句末标点
  - 改动文件：llm-service.js

- ✅ [2026-05-10] TTS 生成时忽略内部标记标签 `[(xxx)]`
  - `stripMarkdown` 增加 `/\[\([^)]*\)\]/g` 过滤规则
  - 改动文件：server-app.js

- ✅ [2026-05-09] 修复 TTS 并发生成导致播放顺序错乱
  - 多句分开发送后，各句 tts.generateTTS() 异步完成顺序不定，音频发送错乱
  - 所有 onSentence 回调内用 ttsQueue Promise 链串行化 TTS 生成与发送
  - 改动文件：server-app.js（2处）, agents/index.js（2处）
  - 实现文档：docs/spec/chat-system.md

### 新功能

- ✅ [2026-05-09] 日志系统与消息日志整合——消息链路追踪
  - 控制端发送显示端指令时自动生成 correlationId，贯穿控制端→服务器→显示端→ACK 全链路
  - sendToDisplay 自动注入 correlationId 到下行消息，显示端回传至 commandAck
  - commandAck 改为 WS 级别日志并携带 source/targetId/correlationId
  - LogViewer 缩进渲染改为序号深度（同 correlationId 条目按顺序递增缩进）
  - 改动文件：server-app.js, display.html, log-viewer.js
  - 设计文档：docs/design/log-viewer.md
  - 实现文档：docs/spec/log-viewer.md

- ✅ [2026-05-09] 客户端日志上报控制
  - 控制端日志面板新增日志上报配置区域，可设置显示端/控制端是否上报及级别阈值
  - 显示端支持接收 logReportConfig，按级别阈值过滤后上报 clientLog
  - 控制端通过覆盖 console.log/error 拦截浏览器日志，按配置发送到服务器
  - 新增消息类型：setLogReport、logReportConfig、clientLog、logReportConfigApplied
  - 改动文件：server-app.js, main.js, upload.html, upload.css, log-viewer.js, websocket.js
  - 任务文档：docs/task/2026-05-09_客户端日志上报控制.md

- ✅ [2026-05-07] LLM 配置支持独立设置上下文条数
  - 每个 LLM 配置（profile）可独立设置"群聊上下文条数"，切换配置时自动切换
  - 群聊时携带最近 N 条消息作为上下文发给 LLM（0=关闭）
  - 改动文件：llm-service.js, server-app.js, chat.js, upload.html, config-app-service.js

- ✅ [2026-05-07] 控制端支持添加/编辑/删除 LLM 配置
  - 聊天设置弹窗新增配置编辑表单（name、apiUrl、model、maxTokens、temperature、apiKey）
  - 配置列表增加编辑和删除按钮
  - LLM 请求自动附加 `Authorization: Bearer` 头（配置了 apiKey 时）
  - 改动文件：upload.html, chat.js, chat.css, llm-service.js, config-app-service.js, docs/spec/chat-system.md
  - 修复：config-app-service.js 的 chat 默认值新增 apiKey 字段，确保 DataSnapshot 持久化时不会丢失
  - 修复：`getConfig()` 返回 `llmProfiles` 和 `activeProfile`，防止 `POST /api/chat/config` 和 `POST /api/chat/profiles/switch` 保存时丢掉 profiles

### Bug 修复

- ✅ [2026-05-08] 控制端关闭"语音识别"后显示端仍在录音
  - `voiceRecognition: false` 时只停止了本地 SherpaASR 流，未停止 MediaRecorder 和麦克风流
  - 改为调用 `stopVoiceRecording()` 彻底停止所有录音
  - 改动文件：display.html

- ✅ [2026-05-08] 网页显示端启动时未读取服务器端录音设置，启动后直接录音
  - 服务器连接时未将用户覆盖的能力值发送给显示端；处理 `capabilities` 消息后也未发回 `capabilitiesUpdated`
  - 显示端 `onopen` 后直接启动录音，未等待服务器能力确认
  - 修复：服务器连接时发送初始 `capabilitiesUpdated`（含 userCapabilities 覆盖）
  - 修复：服务器收到 `capabilities` 后合并 userCapabilities，发回 `capabilitiesUpdated`
  - 修复：显示端改为等待 `capabilitiesUpdated` 后按服务器能力决定是否启动录音
  - 修复：`startVoiceRecording()` 增加 `voiceRecognition` 检查
  - 改动文件：display.html, server-app.js, docs/spec/display-capability.md

- ✅ [2026-05-08] 控制端动态开启显示端录音功能未生效
  - `handleCapabilitiesUpdated` 只有关闭→停止的防御逻辑，缺少开启→启动的前瞻逻辑
  - 修复：检测到 `voiceRecording` 或 `voiceRecognition` 从关闭变为开启时，自动启动录音
  - 改动文件：display.html

- ✅ [2026-05-07] TTS 播报前移除 Markdown 标记符号
  - LLM 返回的 **粗体**、`代码`、[链接](url) 等格式符号不再被 TTS 朗读
  - 仅影响 TTS 播报文本，聊天界面仍显示原始 Markdown
  - 改动文件：server-app.js, llm-service.js
  - 新增 `stripMarkdown()` 处理表格、列表等复杂格式
  - 控制端重播 TTS（playMessage / playText）同样使用 stripMarkdown 清洗后再分句生成音频
  - `isSentenceEnd()` 新增换行符分句，避免 markdown 表格积累成一整段
  - 新增 `findLastSentenceBoundary()` 在流式场景扫描句尾标点+换行组合分句，避免引文标记等导致不分句

- ✅ [2026-05-07] 修复控制端设置页面 LLM/系统路由按钮颜色显示问题
  - **根本原因**：Settings 用 `const` 定义，顶层 `const` 不会创建 `window` 属性，导致 websocket.js 中 `window.Settings` 永久为 undefined，handleRoutingUpdate 从未被调用
  - 服务端在控制端连接时主动推送 commandRouting，避免客户端额外请求
  - `Settings.init()` 中提前调用 `updateUI()`，防止 CSS 默认红色闪烁
  - 添加 `window.Settings = Settings` 使跨模块访问生效
  - 改动文件：
    - `src/apps/server/boot/server-app.js` (连接时推送 commandRouting)
    - `src/apps/web-mediacenter/ui/public/upload.html` (添加 window.Settings)
  - `Settings.updateUI()` 只会在收到 WebSocket 路由数据后才调用，在此之前按钮显示 CSS 默认红色渐变
  - 修复：在 `init()` 中立即调用一次 `updateUI()`，先将按钮设为非活跃半透明状态
  - 改动文件：`src/apps/web-mediacenter/ui/public/upload.html` (第745行)

- ✅ [2026-05-07] 修复 log-viewer.js `_getDeviceLabel is not a function` 报错
  - `_getDeviceLabel` 方法不存在，实际应为重构后更名的 `_getIdLabel`
  - 改动文件：`src/apps/web-mediacenter/ui/public/js/log-viewer.js` (第278行)

### 新功能

- ✅ [2026-05-07] 语音命令搜索指令优先级高于天气指令
  - 调整 processVoiceCommand 中搜索/天气的判定顺序：搜索先于天气
  - 改动文件：voice-command-app-service.js, docs/spec/voiceCommand.md

- ✅ [2026-05-06] 子显示端 TUI 支持 `r` 键循环切换四种录音模式
  - TUI 录音状态面板显示当前模式名及颜色标识
  - r 键在 browse 模式下循环切换 mute→cut→hard→soft→mute
  - 动态切换：清除旧回调/资源，按新模式重新初始化
  - 改动文件：
    - `src/apps/voice-display-node/tui.js` (新增 mode 常量、updateRecordingState 显示模式、r 键绑定)
    - `src/apps/voice-display-node/main.js` (新增 setRecordingMode 方法、TUI 回调绑定)
    - `docs/spec/voice-display.md` (新增 TUI 录音模式切换小节)

- ✅ [2026-05-06] 子显示端 TUI 新增文本输入行（键盘输入替代语音）
  - 在 voice-display-node TUI 底部新增 blessed.textarea 输入行
  - Tab 切换 browse/input 焦点模式，Enter 发送文本，Esc 退回浏览
  - 输入文本走现有 sendVoiceInput() 流程（与语音识别同链路）
  - 输入模式下 q/C-c 禁止退出，防止误触
  - 改动文件：
    - `src/apps/voice-display-node/tui.js` (新增 initChatInputBar，布局微调，键盘守卫)
    - `src/apps/voice-display-node/main.js` (main 中调用 initChatInputBar)
    - `docs/spec/voice-display.md` (新增 TUI 文本输入功能小节)
    - `.src/app/voice-display-text-input.md` (伪代码)

- ✅ [2026-05-06] 语音指令分级路由：天气/搜索可配置由 LLM 处理
  - 将指令分为 LOW（始终程序处理）和 HIGH（可配置路由）两级
  - 天气/搜索默认为 HIGH 走 LLM，其余指令均为 LOW 走程序处理
  - 支持运行时通过 WebSocket 消息 `updateCommandRouting` 切换路由
  - 路由配置持久化到 config.json
  - 改动文件：
    - `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js` (新增 commandLevelMap、highLevelRouting、checkCommandRouting)
    - `src/apps/server/boot/server-app.js` (新增 updateCommandRouting WS 处理、启动加载路由配置)
    - `.src/app/voice-command-routing.md`
    - `docs/spec/voiceCommand.md`

- ✅ [2026-05-06] LLM 服务器支持多配置切换
  - 在 config.json 的 chat 段新增 llmProfiles 列表和 activeProfile 字段，支持存储多个 LLM 服务器配置
  - 控制端聊天设置面板新增 LLM 服务器配置选择区域，可实时切换
  - 切换配置时广播到所有控制端保持同步
  - 向后兼容：旧的单配置模式自动转换为默认 profile
  - 改动文件：
    - `config/config.json`
    - `src/external/llm/llm-service.js` (新增 getProfiles/setProfiles/switchProfile 等方法)
    - `src/apps/server/boot/server-app.js` (新增 profiles API 和 WebSocket 处理)
    - `src/apps/server/modules/config/config-app-service.js` (新增 chat 段默认值)
    - `src/apps/web-mediacenter/ui/public/js/chat.js` (新增配置切换 UI)
    - `src/apps/web-mediacenter/ui/public/js/websocket.js` (新增 profileSwitched 消息处理)
    - `src/apps/web-mediacenter/ui/public/upload.html` (新增配置选择区域)
    - `src/apps/web-mediacenter/ui/public/css/chat.css` (新增配置选择样式)
    - `docs/spec/chat-system.md`

- ✅ [2026-05-05] ASR 识别结果支持配置强制要求包含中文
  - `config.json` 新增 `asr.requireChinese` 配置项，启用后过滤不含中文的识别结果
  - 改动文件：
    - `config/config.json`
    - `src/apps/server/boot/server-app.js` (hasValidContent 增加 requireChinese 判断)
    - `src/apps/server/modules/config/config-app-service.js` (新增默认值)
    - `docs/design/sherpa-asr.md`
    - `docs/spec/config.md`
    - `docs/spec/sherpa-asr.md`
    - `changelog.md`

> 归档说明：`src/core/config/config.js` 已在 2026-04-25 迁移为 `src/apps/server/modules/config/config-app-service.js`，历史条目中的旧路径仅用于回溯当时改动。

### 目录整理

- ✅ [2026-05-05] voice-display-node 从 3rd/ 迁移到 src/apps/
  - 背景：voice-display-node 是项目自研的 Node.js 子显示端，不属于第三方代码，迁入 src/apps/ 更符合分层架构
  - 改动文件：
    - `3rd/voice-display-node/` → `src/apps/voice-display-node/` (整体迁移)
    - `src/apps/voice-display-node/main.js` (框架引用路径更新)
    - `src/apps/server/boot/server-app.js` (配置路径更新)
    - `docs/spec/project-structure.md`
    - `docs/spec/voice-display.md`
    - `docs/design/project-structure.md`
    - `readme.md`
  - 清理：删除 `3rd/voice-display-node/` 旧目录

### 新功能

- ✅ [2026-04-30] 服务端重新集成 TUI 界面（恢复目录重构时丢失的 blessed 终端界面）
  - root `package.json` 添加 `blessed@^0.1.81` 依赖
  - `server-app.js` 导入 ServerTUI 和 installConsoleRedirect 模块
  - `log()`/`logError()` 增加 useTUI 分支：TUI 模式下走 tui.addLog()，否则走 console.log/error
  - 日志数据库 logBuffer.add + logBrain.ingest 始终执行，不依赖 TUI 开关
  - TUI 模式下调用 installConsoleRedirect() 重定向 console.*，避免第三方库破坏 blessed 渲染
  - 服务器启动后调用 tui.setHeader(protocol, localIP, PORT) 显示标题栏
  - 调用 tui.startRefresh() 建立 2s 定时刷新系统状态和设备列表
  - 复用已有 systemMonitor.onStats 回调接入 tui.updateSystemStats()
  - 支持 `--no-tui` 命令行参数禁用 TUI，回退到纯文本日志
  - 改动文件：
    - `src/apps/server/boot/server-app.js`
    - `package.json`
    - `docs/spec/tui.md`
    - `.src/app/server-tui-integration.md`
    - `.src/app/server-tui-test.md`
    - `src/scripts/test-tui-integration.js`
  - 配置 `asr.mode`：`"isolated"`（默认，独立进程模式）或 `"embedded"`（内嵌模式）
  - 向后兼容旧的 `asr.isolateProcess.enabled` 配置
  - 新增 `asr.reset()` 销毁旧实例、按新配置重建
  - 新增 `GET/POST /api/config/asrMode` 运行时查看/切换模式
  - `/api/asr/status` 返回 `mode` 字段
  - 模式切换后 WebSocket 广播 `asrModeChanged` 事件
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `src/apps/server/boot/server-app.js`
    - `config/config.json`
    - `src/apps/server/modules/config/config-app-service.js`
    - `docs/design/sherpa-asr.md`
    - `docs/spec/sherpa-asr.md`

- ✅ [2026-04-29] ASR 独立进程改为一次性进程模式，识别完立即释放内存
  - IsolatedAsrProcessClient 重写为每次 recognize() fork 新进程，识别完成后子进程 exit(0)
  - 移除持久 worker 管理（startWorker/bindWorkerEvents/rejectAllPending），简化进程生命周期
  - 新增 pendingCount/maxQueueLength 控制并发子进程数量，防止同时加载多个模型实例
  - 超时后 SIGKILL 强制终止，settled 标志防止重复回调
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `src/external/asr/asr-worker-process.js`
    - `docs/design/sherpa-asr.md`
    - `docs/spec/sherpa-asr.md`

### 修复

- ✅ [2026-05-05] 显示端 voiceInput 仅转发到控制端，未走 LLM 处理链路
  - handleDisplayMessageFallback: isFinal 的 voiceInput 增加 `processDisplayVoiceInput()` 调用，
    走 voiceCommand.processVoiceCommand → LLM → executeCommands 或 chat 链路
  - audioChunk 路径同理：asr.recognize 识别出文本后也调用 processDisplayVoiceInput()
  - display 端 chat 结果直接用 TTS 回播到显示端，无需控制端参与
  - 改动文件：
    - `src/apps/server/boot/server-app.js`
    - `docs/spec/tui.md`

- ✅ [2026-05-05] TUI 模式下 ASR 子进程（isolated mode）打印直接写终端破坏 blessed 渲染
  - asr-service.js: fork stdio 从 `inherit` 改为 `pipe`，子进程 stdout/stderr 捕获后经
    父进程 console.log 输出，自动进入 TUI 日志面板
  - console-redirect.js: 新增 _extractCategory() 从 console.log('[Category] msg') 提取类别
  - server-app.js + voice-display-node/main.js: writeLog 回调加上 category 参数支持
  - server-tui.js + tui.js: CATEGORY_COLORS 添加 '语音输入'、'语音命令'、'ASR子进程'
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `src/framework/observability/console-redirect.js`
    - `src/framework/observability/server-tui.js`
    - `src/apps/server/boot/server-app.js`
    - `3rd/voice-display-node/main.js`
    - `3rd/voice-display-node/tui.js`
    - `docs/spec/tui.md`

- ✅ [2026-04-29] WSViewBindServer 异步 handler 未 await 导致控制端反复断连
  - handleControlMessage/handleDisplayMessage 改为 async，await handler 返回值
  - 修复前 handler 返回 Promise，调用方 await 后得 undefined，访问 .success 崩溃
  - 改动文件：
    - `src/core/viewbind/WSViewBindServer.js`

- ✅ [2026-04-29] logUpdate 推送无节流导致控制端刷屏
  - 新增 200ms 节流定时器，批量更新合并推送，每次只发最后 50 条
  - 改动文件：
    - `src/apps/server/boot/server-app.js`

- ✅ [2026-04-29] 控制端消息类型缺失导致 tts/timeAnnounce 等被静默丢弃
  - controlTypes 补全缺失类型：tomorrowReminders/mediaBatch/tts/getState/media/control/chat/chatMessage/executeCommands
  - testTimeAnnounce 移到 `if (!displayData) return;` 前面，不依赖 displayId
  - 改动文件：
    - `src/apps/server/boot/server-app.js`

### 变更

- ✅ [2026-04-29] ASR 默认模式改为 isolated（独立进程），config 中 mode 默认值同步更新

### 优化

- ✅ [2026-04-29] 日志系统显示格式改为箭头对话模式
  - LogEntry 中的 source/targetId 渲染为 `设备A ⇒ 设备B: 消息` 格式
  - 同一 correlationId 的连续消息自动缩进，展示对话链路
  - ACK 消息添加（ACK）标记
  - websocket.js 新增 logUpdate 类型处理
  - 改动文件：
    - `src/apps/web-mediacenter/ui/public/js/log-viewer.js`
    - `src/apps/web-mediacenter/ui/public/js/websocket.js`
    - `src/apps/web-mediacenter/ui/public/css/upload.css`

- ✅ [2026-04-29] ViewBind connect 扩展与 WS 消息系统替换
  - ViewBind 新增 connect 字段：外部注入 TransportConnector 实现，数据变化自动同步到远端
  - 新增 WSClientConnector：TransportConnector 的 WebSocket 传输实现，支持断线重连
  - 新增 WSViewBindServer：基于 ViewBindList 替代 WebSocketSystem，管理显示端生命周期
  - server-app.js 中 6 个 aascSystem 调用点替换为 wsServer，handler 注册替代 Actor 路由
  - 改动文件：
    - `src/core/viewbind/ViewBind.js`
    - `src/core/viewbind/WSClientConnector.js`
    - `src/core/viewbind/WSViewBindServer.js`
    - `src/core/viewbind/index.js`
    - `src/core/viewbind/WSClientConnector.test.js`
    - `src/core/viewbind/WSViewBindServer.test.js`
    - `src/apps/server/boot/server-app.js`
    - `.src/core/viewbind-connect.md`
    - `.src/core/viewbind-connect-models.md`
    - `.src/core/viewbind-ws-models.md`
    - `.src/framework/viewbind-ws-transport.md`
    - `.src/framework/viewbind-ws-server.md`
    - `.src/app/viewbind-ws-integration.md`
    - `.src/core/viewbind-connect.test.md`
    - `.src/framework/viewbind-ws.test.md`
    - `.src/app/viewbind-ws-integration.test.md`

- ✅ [2026-04-29] 显示端→服务端音频流转 + 聊天式日志系统基础
  - 新增 audioChunk handler：显示端采集音频分片发送到服务端，合并后调 asr.recognize
  - LogEntry 扩展 correlationId/scope/source/targetId 字段，支持链路追踪
  - 新增 logViewBind 实例：日志写入时自动通过 ViewBind 增量推送到控制端
  - 新增 subscribeLog/unsubscribeLog/setLogLevel 日志订阅 handler
  - 改动文件：
    - `src/apps/server/boot/server-app.js`
    - `src/framework/observability/log-buffer.js`
    - `.src/core/display-asr-models.md`
    - `.src/core/log-models.md`
    - `.src/framework/display-asr-handler.md`
    - `.src/framework/log-viewbind-bridge.md`
    - `.src/app/display-asr-integration.md`
    - `.src/app/log-system-integration.md`
    - `.src/core/display-asr.test.md`
    - `.src/core/log-system.test.md`

- ✅ [2026-04-28] malloc-trim 添加开关控制
  - `SherpaOnnxASR` 构造函数新增 `mallocTrimEnabled` 选项，默认 true
  - false 时跳过 malloc_trim 调用，V8 GC 不受影响
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `docs/spec/sherpa-asr.md`

- ✅ [2026-04-28] ASR 原生内存诊断与回收
  - 新增 RSS 内存分布诊断：`getRssLayout()` 读取 smaps_rollup，`getTopSmapsRss()` 解析 smaps 按区段 RSS 排序输出 Top8
  - 新增 `src/native/malloc-trim/` C++ N-API addon，调用 glibc `malloc_trim(0)` 回收 ONNX Runtime arena 空闲内存
  - `tryCompactMemory()` 重写：每 20 次识别 / 最少 5 分钟间隔执行一次，先 V8 GC 再 malloc_trim
  - `numThreads` 从 4 降至 1，减少线程池和中间缓冲区占用的 RSS
  - ASR 识别前后打印 RSS 变化量和音频文件大小
  - 定时清理临时文件时打印文件名和大小（`formatFileSize`）
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `3rd/ttslive/core/asr.js`
    - `src/apps/server/boot/server-app.js`
    - `src/native/malloc-trim/malloc-trim.cc` (新增)
    - `src/native/malloc-trim/binding.gyp` (新增)
    - `docs/spec/sherpa-asr.md`
  - 新增 12 个测试分类覆盖：服务器生命周期、单/多显示端连接、多控制端连接、显示端断连、消息通信、控制端到显示端转发、显示端状态上报、ViewBind 集成自动通知、边界情况（无效JSON/空消息/未知路径）、压力场景（10并发/急速连接断开/大量消息）、高频心跳
  - 沿用原有集成自测框架，累计 45 个测试全部通过
  - 改动文件：`src/core/viewbind/ViewBind.integration.test.js`、`docs/spec/viewbind.md`

### Bug 修复

- ✅ [2026-04-29] 修复控制端发送聊天后服务端无响应
  - Agent 方法中 `ws` 从 `params` 解构但实际在 `context.ws` 中，导致所有 `ws.send()` 回调被静默跳过
  - 影响 ChatAgent.processChatMessage / processMessage、VoiceCommandAgent.processCommand / executeCommands、TTSAgent.playText 共5个方法
  - 改动文件：
    - `src/framework/aasc/agents/index.js`

- ✅ [2026-04-28] 修复显示端能力重启动服务器后丢失
  - 显示端声明能力时写入 config.json（`config.updateDisplayState`）
  - 控制端修改能力时写入 config.json
  - 显示端重连重新声明能力时，保留用户已设置的覆盖值（合并策略）
  - 改动文件：
    - `src/apps/server/boot/server-app.js`

- ✅ [2026-04-28] 修复能力持久化合并顺序导致 TTS 不播
  - 显示端重连时持久化 `voicePlayback=false` 覆盖了硬件声明的 `true`
  - 将用户覆盖值(`userCapabilities`)与硬件能力分开跟踪
  - 声明能力时：硬件为基础 → 叠加用户覆盖值
  - 改动文件：
    - `src/apps/server/boot/server-app.js`

- ✅ [2026-04-28] TTS/chime 测试播放问题修复
  - 修复 `broadcastDisplayList()` 递归调用自身而非发送广播的 bug，导致显示端变化无法通知控制端
  - AASC `getDisplayList()` 缺少 `capabilities` 字段，控制端看不到能力信息
  - 改动文件：
    - `src/apps/server/boot/server-app.js`
    - `src/framework/aasc/components/state-manager.js`

- ✅ [2026-04-28] 显示端能力切换时联动关闭对应功能
  - mediaRendering=false → 停止媒体播放，清空画面
  - voicePlayback=false → 停止 TTS，清空播放队列
  - displayText=false → 隐藏提醒弹窗和文字覆盖层
  - 改动文件：
    - `src/apps/web-mediacenter/ui/public/display.html`

- ✅ [2026-04-28] 设备列表视图模式持久化
  - `viewMode`（tree/list）保存到 localStorage，刷新页面后保持
  - 树形视图的 `expandedNodes` 展开状态保存到 localStorage
  - 改动文件：
    - `src/apps/web-mediacenter/ui/public/js/device-list.js`

### 新功能

- ✅ [2026-04-27] 实现消息批处理与双向通信通道
  - MessageBatch：按时间窗口/最大条数聚合消息，支持合并函数
  - MessageBus 扩展：集成 setBatchConfig/removeBatchConfig，publish 自动走批处理
  - ClientChannel：客户端通信封装，订阅 topic 和私有通道，断连自动清理
  - ServerChannel：服务端通信封装，支持单播 push、广播 broadcast、clientId 生成
  - 改动文件：`src/framework/aasc/message-batch.js`、`src/framework/aasc/message-bus.js`、`src/framework/aasc/channel/client-channel.js`、`src/framework/aasc/channel/server-channel.js`、`src/framework/aasc/index.js`、`docs/spec/aasc.md`

- ✅ [2026-04-27] 实现 RSS 内存压测脚本
  - 通用的 HTTP 压测脚本，支持可配置的 method/path/body/headers
  - 两种运行模式：total（按请求数+并发）和 interval（按间隔+持续时间）
  - 定时采集服务端 `/api/system-stats` 的 RSS/Heap/External 数据
  - 同时记录本地压测进程内存占用
  - 输出 ASCII 曲线图和最终报告（峰值内存、成功率、平均/最大延迟）
  - 改动文件：`src/scripts/rss-stress-test.js`、`docs/spec/rss-stress-test.md`

### Bug 修复
- ✅ [2026-04-27] ViewBind 回调重入语义修复与列表索引重建
  - 问题：ViewBind 通知期间调用 bind/unbind/修改 data 可能导致漏帧或状态不一致；ViewBindList.setList() 排序后按索引匹配 ViewBind 会导致绑定错位
  - 修复：
    - `ViewBind.js`：通知期间 `unbind()` 立即从 Set 移除（本轮后续快照检查跳过），`bind()` 暂存到 `_pendingBinds` 通知结束后补发，`data` 修改设 `_pendingNotifyAll` 通知结束后补帧
    - `ViewBindList.js`：`setList()` 改为 `Map<dataRef, Queue<ViewBind>>` 按 data 引用重建 `_binds` 索引，排序/重排后绑定正确对齐
    - `ViewBindList.js`：`_notifyAll` 增加快照 + `_pendingNotifyAll` 重入处理
  - 新增 7 个自测：回调中解绑、回调中绑定、回调中改数据、回调替换、List old/new 长度、List 按 data 定位、List 排序后索引重建（总计 30 个测试全部通过）
  - 改动文件：
    - `src/core/viewbind/ViewBind.js`
    - `src/core/viewbind/ViewBindList.js`
    - `src/core/viewbind/ViewBind.test.js`
    - `docs/spec/viewbind.md`
    - `docs/design/viewbind.md`
    - `docs/task/2026-04-27_UIViewBind自测补充与回调重入修复.md`

- ✅ [2026-04-27] ViewBind 通信机制自测代码
  - 新增 `ViewBind.self-test.js`，46 个自测用例覆盖：基础通信模式、生产-消费模式、重入一致性、列表通信、链式通信、边界情况、错误隔离、通信可靠性、资源清理、列表迭代
  - 改动文件：
    - `src/core/viewbind/ViewBind.self-test.js`
    - `docs/spec/viewbind.md`

- ✅ 服务端 RSS 持续上涨综合修复（第四轮 - 系统性加固）
  - 问题：服务器长时间运行后 RSS 持续上涨，即使在低负载时期也不回落
  - 原因分析：
    1. `MessageBus.stats` 中 `messagesByRuntime` 和 `runtimeMessagesByDevice` 按 runtimeId/deviceId 累积计数，永不清除
    2. `deviceEventDebounce` Map 每 5 分钟才清理过期 >60s 的条目，短时间窗口内大量不同 IP 的连接会导致 Map 膨胀
    3. `DataSnapshot.createNestedProxy` 每次访问嵌套属性都创建全新 Proxy 对象，高频访问下 GC 压力大，V8 倾向于保留更多内存
    4. `chatHistory` 单个消息内容无大小限制，大文本（如 base64 图片）可导致单条消息占用数 MB
    5. WebSocket 连接异常断开时可能未触发 close 事件，导致 `displayClients`/`controlClients` 残留僵尸连接
  - 修复：
    - `src/framework/aasc/message-bus.js`：新增 `trimStats()` 方法，按消息数量排序保留 top 200 条统计键，其余删除；服务端每分钟自动调用
    - `src/apps/server/boot/server-app.js`：`deviceEventDebounce` 清理间隔从 5 分钟改为 1 分钟，清理阈值从 `DEBOUNCE_MS * 2` 改为 `DEBOUNCE_MS`
    - `src/apps/server/boot/server-app.js`：新增 WebSocket 连接健康检查，每分钟扫描 `displayClients`/`controlClients` 中 `readyState` 不为 OPEN 的僵尸连接并清理
    - `src/apps/server/boot/server-app.js`：runtimeBridge 的 `error` 事件处理中增加清理逻辑，确保异常断开时释放引用
    - `src/core/data-snapshot/DataSnapshot.js`：`createNestedProxy` 改为 `getCachedProxy`，使用 WeakMap 缓存已创建的 Proxy 对象，避免重复创建
    - `src/external/llm/llm-service.js`：新增 `MAX_MESSAGE_LENGTH = 51200`，`addMessage` 和 `chat` 方法中自动截断超出内容，防止单条大消息撑爆内存
  - 改动文件：
    - `src/framework/aasc/message-bus.js`
    - `src/core/data-snapshot/DataSnapshot.js`
    - `src/external/llm/llm-service.js`
    - `src/apps/server/boot/server-app.js`
    - `docs/spec/aasc.md`
    - `docs/spec/data-snapshot.md`
    - `changelog.md`
    - `docs/task/2026-04-27_RSS持续上涨综合修复.md` (新增)
- ✅ 文档路径术语统一到当前目录结构
  - 需求：在已完成目录归位后，继续统一文档中的旧路径示例，降低新成员理解成本
  - 实现：
    - `docs/rules.md` 项目结构示例更新为当前目录（`src/apps/server/boot/server-app.js`、`src/apps/web-mediacenter/ui/public/`、`res/`、`3rd/`）
    - `docs/ref.md` 项目结构示例更新为当前分层架构，移除旧 `core/public/uploads` 根目录示意
    - `docs/design.md` 系统架构图中的文件管理路径改为 `res/uploads/`
    - `docs/design/sherpa-asr.md` 与 `docs/spec/sherpa-asr.md` 路径更新为 `src/apps/server/boot/server-app.js`、`src/scripts/asr-stress-test.js`
    - `docs/spec/voice-display.md` 子显示端路径更新为 `3rd/voice-display/` 与 `3rd/voice-display-node/`
    - `docs/design/viewbind.md` 与 `docs/spec/viewbind.md` 示例路径更新为 `src/core/viewbind`、`src/core/data-snapshot`
    - `docs/design/project-structure.md`、`docs/spec/project-structure.md` 补充文档路径统一策略与校验伪代码
    - 更新 `docs/todo.md` 最后检查时间
    - 新增任务记录 `docs/task/2026-04-27_文档路径术语统一.md`
  - 改动文件：
    - `docs/rules.md`
    - `docs/ref.md`
    - `docs/design.md`
    - `docs/design/sherpa-asr.md`
    - `docs/spec/sherpa-asr.md`
    - `docs/spec/voice-display.md`
    - `docs/design/viewbind.md`
    - `docs/spec/viewbind.md`
    - `docs/design/project-structure.md`
    - `docs/spec/project-structure.md`
    - `docs/todo.md`
    - `docs/task/2026-04-27_文档路径术语统一.md` (新增)
- ✅ 历史目录清理与资源目录归位
  - 需求：继续整理代码结构，移除根目录历史残留目录，统一运行时资源到 `res/` 目录
  - 实现：
    - 清理根目录历史目录：`uploads/`、`temp/`、`models/`、`routes/`、`viewbind/`、`voice-display/`、`voice-display-node/`
    - 资源归位：将 `uploads/*` 迁移到 `res/uploads/`，将 `temp/asr-stress-sample.wav` 与 `temp/asr/*` 迁移到 `res/temp/asr/`
    - 补齐运行时目录：创建 `res/uploads/`、`res/temp/asr/`、`res/temp/uploads/`
    - 更新压测脚本默认样本路径：`src/scripts/asr-stress-test.js` 改为读取 `res/temp/asr/asr-stress-sample.wav`
    - 更新忽略规则：`.gitignore` 从旧根目录忽略切换为 `res/uploads/`、`res/temp/`
    - 更新工程目录结构 design/spec 文档，补充历史目录清理与资源归位伪代码
    - 更新 `docs/todo.md` 最后检查时间
    - 新增任务记录 `docs/task/2026-04-27_整理代码结构并清理历史目录.md`
  - 改动文件：
    - `.gitignore`
    - `src/scripts/asr-stress-test.js`
    - `docs/design/project-structure.md`
    - `docs/spec/project-structure.md`
    - `docs/todo.md`
    - `docs/task/2026-04-27_整理代码结构并清理历史目录.md` (新增)
- ✅ AASC 与 Auto-Brain 迁移到 Framework 层
  - 需求：将 `aasc` 与 `auto-brain` 统一归入 Framework 层，收敛基础设施边界
  - 实现：
    - 目录迁移：`src/aasc/* -> src/framework/aasc/*`
    - 目录迁移：`src/auto-brain/* -> src/framework/auto-brain/*`
    - `src/apps/server/boot/server-app.js` 改为依赖 `src/framework/aasc/init`
    - `src/scripts/run-log-brain-tests.js` 改为依赖 `src/framework/aasc/message-bus.runtime-chain.test`
    - 补充静态调试路由：`/aasc -> src/framework/aasc`、`/auto-brain -> src/framework/auto-brain`
    - 修正 AASC 目录迁移后的跨层相对路径引用
    - 更新分层/目录/规则文档和任务记录
    - 新增任务记录 `docs/task/2026-04-25_AASC与Auto-Brain迁移到Framework层.md`
  - 改动文件：
    - `src/framework/aasc/*` (由 `src/aasc/*` 迁移)
    - `src/framework/auto-brain/*` (由 `src/auto-brain/*` 迁移)
    - `src/apps/server/boot/server-app.js`
    - `src/scripts/run-log-brain-tests.js`
    - `docs/design/project-structure.md`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/rules.md`
    - `readme.md`
    - `docs/task/2026-04-25_AASC与Auto-Brain迁移到Framework层.md` (新增)
- ✅ 配置模块旧路径文档归档说明统一化
  - 需求：减少历史文档中 `src/core/config/config.js` 路径对当前实现的误导
  - 实现：
    - 在 `changelog.md` 顶部新增归档说明，明确当前路径为 `src/apps/server/modules/config/config-app-service.js`
    - 更新 `docs/rules.md` 路径规则，补充“历史文档可保留旧路径但需标注现路径”
    - 更新 `docs/design/websocket.md`、`docs/design/device-tree.md`、`docs/spec/device-tree.md`、`docs/spec/api.md`、`docs/design/data-snapshot.md` 路径说明
    - 补充近期任务文档中的“现路径”注记
    - 新增任务记录 `docs/task/2026-04-25_配置路径归档说明.md`
  - 改动文件：
    - `changelog.md`
    - `docs/rules.md`
    - `docs/design/websocket.md`
    - `docs/design/device-tree.md`
    - `docs/spec/device-tree.md`
    - `docs/spec/api.md`
    - `docs/design/data-snapshot.md`
    - `docs/task/2026-04-24_ASR独立进程开关.md`
    - `docs/task/2026-04-24_TTS内存风险加固.md`
    - `docs/task/2026-04-25_配置路径归档说明.md` (新增)
- ✅ 配置模块迁移到 App 层（server 应用）
  - 需求：将 `config.js` 放到 App 层，减少 Core 层应用耦合
  - 实现：
    - 新增 `src/apps/server/modules/config/config-app-service.js` 承接原配置实现
    - 删除 `src/core/config/config.js`
    - `src/apps/server/boot/server-app.js` 与 `src/aasc/agents/index.js` 切换到新配置路径
    - 更新分层与配置文档，补充迁移伪代码和任务记录
    - 新增任务记录 `docs/task/2026-04-25_配置模块迁移到App层.md`
  - 改动文件：
    - `src/apps/server/modules/config/config-app-service.js` (新增)
    - `src/core/config/config.js` (删除)
    - `src/apps/server/boot/server-app.js`
    - `src/aasc/agents/index.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/spec/config.md`
    - `docs/task/2026-04-25_配置模块迁移到App层.md` (新增)
- ✅ 新增 TTS 压测脚本（联动 system-stats）
  - 需求：提供可复用工具评估 TTS 生成链路在并发下的稳定性和内存表现
  - 实现：
    - 新增 `src/scripts/tts-stress-test.js`，支持 `--url/--text/--voice/--speed/--total/--concurrency/--timeout/--output-every`
    - 默认联动 `GET /api/system-stats` 采样，输出服务端内存峰值与 RSS/External/ArrayBuffers ASCII 曲线
    - 支持 `--no-system-stats` 关闭服务端采样
    - `package.json` 新增脚本命令 `npm run stress:tts`
    - 更新 `docs/design/tts.md` 与 `docs/spec/tts.md`
    - 新增任务记录 `docs/task/2026-04-24_TTS压测脚本.md`
  - 改动文件：
    - `src/scripts/tts-stress-test.js` (新增)
    - `package.json`
    - `docs/design/tts.md`
    - `docs/spec/tts.md`
    - `docs/task/2026-04-24_TTS压测脚本.md` (新增)
- ✅ 服务端 ASR 增加独立进程开关（降低主进程 RSS）
  - 需求：支持通过开关将语言识别放到独立进程，减少主服务进程 RSS 压力
  - 实现：
    - `config/config.json` 与 `src/core/config/config.js` 新增 `asr.isolateProcess` 配置（`enabled/requestTimeoutMs/autoRestart`）
    - `src/external/asr/asr-service.js` 新增 `IsolatedAsrProcessClient`，支持 IPC 请求、超时保护、异常退出自动重启
    - 新增 `src/external/asr/asr-worker-process.js`，子进程内加载 `SherpaOnnxASR` 执行识别
    - `/api/asr/status` 增加 `isolatedProcessEnabled` 字段，便于控制端确认当前模式
    - 更新 `docs/design/sherpa-asr.md`、`docs/spec/sherpa-asr.md`，补充进程隔离设计和伪代码
    - 新增任务记录 `docs/task/2026-04-24_ASR独立进程开关.md`
  - 改动文件：
    - `config/config.json`
    - `src/core/config/config.js`
    - `src/external/asr/asr-service.js`
    - `src/external/asr/asr-worker-process.js` (新增)
    - `src/apps/server/boot/server-app.js`
    - `docs/design/sherpa-asr.md`
    - `docs/spec/sherpa-asr.md`
    - `docs/task/2026-04-24_ASR独立进程开关.md` (新增)
- ✅ 工程目录结构整理
  - 需求：整理项目文件结构说明，统一根目录职责并补齐文档索引
  - 实现：
    - 更新 `readme.md` 的项目结构树，移除旧 `core/*` 表述，改为当前分层目录
    - 将服务端入口由根目录 `server.js` 迁移为 `src/apps/server/boot/server-app.js`
    - 启动目录命名由 `bootstrap` 简化为 `boot`
    - `package.json` 的 `main` 与 `start` 同步切到新入口路径
    - 根目录收敛迁移：`aasc -> src/aasc`、`auto-brain -> src/auto-brain`、`scripts -> src/scripts`
    - 控制端静态资源迁移：`public -> src/apps/web-mediacenter/ui/public`
    - 子显示端目录迁移：`voice-display* -> 3rd/voice-display*`
    - 根目录自测结果文件迁移：`self-test-results-*.json -> docs/self-test-results/`
    - `readme.md` 文档索引新增 `docs/self-test-results/` 归档入口
    - 新入口统一通过 `PROJECT_ROOT` 解析 `res/config/src/apps/web-mediacenter/ui/public/3rd/voice-display-node` 路径
    - 新增 `docs/design/project-structure.md`，定义根目录职责与治理规则
    - 新增 `docs/spec/project-structure.md`，补充目录同步与归位校验伪代码
    - 更新 `docs/design.md`、`docs/spec.md` 索引并同步 `docs/todo.md` 检查时间
    - 新增任务记录 `docs/task/2026-04-24_整理文件结构.md`
    - 新增任务记录 `docs/task/2026-04-24_服务端入口迁移到src.md`
    - 新增任务记录 `docs/task/2026-04-24_根目录收敛迁移.md`
  - 改动文件：
    - `package.json`
    - `src/apps/server/boot/server-app.js` (由 `server.js` 迁移)
    - `src/apps/server/boot/README.md` (由 `bootstrap/README.md` 迁移)
    - `src/scripts/run-log-brain-tests.js` (由 `scripts/run-log-brain-tests.js` 迁移)
    - `src/scripts/asr-stress-test.js` (由 `scripts/asr-stress-test.js` 迁移)
    - `src/aasc/*` (由 `aasc/*` 迁移)
    - `src/auto-brain/*` (由 `auto-brain/*` 迁移)
    - `src/apps/web-mediacenter/ui/public/*` (由 `public/*` 迁移)
    - `3rd/voice-display/*` (由 `voice-display/*` 迁移)
    - `3rd/voice-display-node/*` (由 `voice-display-node/*` 迁移)
    - `3rd/voice-display-cs/*` (由 `voice-display-cs/*` 迁移)
    - `docs/self-test-results/self-test-results-2026-03-31T14-03-26-551Z.json` (由根目录迁移)
    - `.gitignore`
    - `readme.md`
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/todo.md`
    - `docs/design/project-structure.md` (新增)
    - `docs/spec/project-structure.md` (新增)
    - `docs/task/2026-04-24_整理文件结构.md` (新增)
    - `docs/task/2026-04-24_服务端入口迁移到src.md` (新增)
    - `docs/task/2026-04-24_根目录收敛迁移.md` (新增)

### Bug 修复
- ✅ 服务端 TTS 生成链路内存风险加固
  - 问题：TTS 外部调用在网络异常场景下缺少超时和统一资源回收，可能导致连接/流长期占用并引发 RSS 持续波动
  - 修复：
    - `src/external/tts/tts-service.js` 增加 `requestTimeoutMs` 超时控制，请求超时后主动销毁连接
    - TTS 音频写盘改为 `pipeline()`，统一成功/失败回调，减少流状态遗漏
    - 失败路径统一删除半写音频文件，避免残留文件占用
    - 非 200 响应增加 `maxErrorBytes` 限制，防止异常大错误体导致内存突增
    - `config/config.json` 与 `src/core/config/config.js` 新增 TTS 稳定性配置项
    - `/api/tts/config` 支持读写 `requestTimeoutMs/maxErrorBytes`
    - 新增 `docs/design/tts.md` 与 `docs/spec/tts.md`，补充设计与伪代码
    - 新增任务记录 `docs/task/2026-04-24_TTS内存风险加固.md`
  - 改动文件：
    - `src/external/tts/tts-service.js`
    - `src/core/config/config.js`
    - `config/config.json`
    - `src/apps/server/boot/server-app.js`
    - `docs/design/tts.md` (新增)
    - `docs/spec/tts.md` (新增)
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/spec/config.md`
    - `docs/todo.md`
    - `docs/task/2026-04-24_TTS内存风险加固.md` (新增)
- ✅ 日志大脑页面增强（自动刷新 + 诊断历史缓存）
  - 需求：日志大脑页支持持续观测和历史复盘
  - 实现：
    - 新增自动刷新开关和刷新间隔（5s/15s/30s）
    - 仅在日志大脑面板激活时启动轮询，离开面板自动停止
    - 新增本地诊断历史缓存（最多 20 条）
    - 历史记录支持“载入问题”回填到诊断输入框
  - 改动文件：
    - `public/js/log-brain-viewer.js`
    - `public/upload.html`
    - `public/css/upload.css`
    - `public/js/main.js`
    - `docs/design/log-brain.md`
    - `docs/spec/log-brain.md`
    - `docs/task/2026-04-23_日志大脑自动刷新与历史缓存.md` (新增)
- ✅ 日志大脑诊断可视化与自动化测试收尾
  - 需求：日志大脑接入 LLM 真诊断、控制端可视化、阈值配置化、最小回归测试和目录映射规则补齐
  - 实现：
    - 新增 `POST /api/logs/brain-diagnose`，内部调用 `src/external/llm/llm-service.js`
    - 新增 `src/apps/server/api/log-brain-api.js`，统一承载 `brain-summary`/`brain-judge`/`brain-diagnose`
    - `src/framework/observability/log-brain.js` 增加阈值配置、时间线输出、风险分级和 LLM 失败回退诊断
    - 控制端新增“日志大脑”页（摘要卡片、时间线、一键诊断、诊断结果面板）
    - `config/config.json` 与 `src/core/config/config.js` 增加 `logBrain` 阈值配置项
    - 新增自动化测试：`log-brain` 单测、日志大脑 API 集成测试、runtime->device transport->receive 链路测试
    - 新增测试入口 `npm run test:log-brain`
    - `docs/rules.md` 新增目录映射表和“禁止新增旧路径引用”规则
    - 新增任务记录 `docs/task/2026-04-23_日志大脑诊断可视化与测试收尾.md`
  - 改动文件：
    - `server.js`
    - `src/framework/observability/log-brain.js`
    - `src/apps/server/api/log-brain-api.js` (新增)
    - `src/core/config/config.js`
    - `config/config.json`
    - `public/upload.html`
    - `public/js/main.js`
    - `public/js/log-brain-viewer.js` (新增)
    - `public/css/upload.css`
    - `src/framework/observability/log-brain.test.js` (新增)
    - `src/apps/server/api/log-brain-api.integration.test.js` (新增)
    - `aasc/message-bus.runtime-chain.test.js` (新增)
    - `scripts/run-log-brain-tests.js` (新增)
    - `package.json`
    - `docs/design/log-brain.md`
    - `docs/spec/log-brain.md`
    - `docs/spec/config.md`
    - `docs/rules.md`
    - `docs/todo.md`
    - `docs/task/2026-04-23_日志大脑诊断可视化与测试收尾.md` (新增)
- ✅ Core 第七步收口（剩余模块迁移）
  - 需求：迁移 core 目录剩余模块并删除空 core 目录，完成分层收口
  - 实现：
    - 迁移 `core/config.js` 到 `src/core/config/config.js`
    - 迁移 `core/timeParser.js` 到 `src/core/utils/time-parser.js`
    - 迁移 `core/console-redirect.js` 到 `src/framework/observability/console-redirect.js`
    - 迁移 `core/connection.js` 到 `src/framework/transport/ws/connection.js`
    - 迁移 `core/tui.js` 和 `core/tui-utils.js` 到 `src/framework/observability/`
    - 迁移 `core/data-snapshot/*` 到 `src/core/data-snapshot/*`
    - 迁移 `core/viewbind/*` 到 `src/core/viewbind/*`
    - 替换 `server.js`、`aasc/agents/index.js`、`voice-display-node/main.js`、`voice-command-app-service.js` 引用到新路径
    - 批量更新 design/spec 文档中的已迁移模块路径到 `src/*`
    - 删除空 `core/` 目录
    - 更新分层文档与任务记录 `docs/task/2026-04-23_Core第七步剩余模块迁移.md`
  - 改动文件：
    - `server.js`
    - `aasc/agents/index.js`
    - `voice-display-node/main.js`
    - `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js`
    - `src/core/config/config.js`
    - `src/core/utils/time-parser.js`
    - `src/core/data-snapshot/*`
    - `src/core/viewbind/*`
    - `src/framework/observability/console-redirect.js`
    - `src/framework/transport/ws/connection.js`
    - `src/framework/observability/server-tui.js`
    - `src/framework/observability/tui-utils.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/spec.md`
    - `docs/task/2026-04-23_Core第七步剩余模块迁移.md` (新增)
- ✅ Core 第六步收口清理（移除兼容导出）
  - 需求：完成已迁移模块的 core 收口，统一使用新分层路径
  - 实现：
    - 替换 `server.js`、`aasc/actors/*`、`aasc/agents/index.js`、`voice-display-node/main.js` 对已迁移 `core/*` 的引用
    - 删除已迁移兼容文件：`core/asr.js`、`core/tts.js`、`core/chat.js`、`core/voiceCommand.js`、`core/reminder.js`、`core/timeAnnounce.js`、`core/timeListener.js`、`core/media-library.js`、`core/sub-server.js`、`core/log-buffer.js`、`core/system-monitor.js`、`core/media.js`
    - 更新分层文档，新增 Core 第六阶段收口说明
    - 更新 AASC 与 ASR 相关 spec/design 路径说明到新模块位置
    - 新增任务记录 `docs/task/2026-04-23_Core第六步收口清理.md`
  - 改动文件：
    - `server.js`
    - `aasc/actors/chat-actor.js`
    - `aasc/actors/important-record-actor.js`
    - `aasc/actors/private-chat-actor.js`
    - `aasc/actors/system-command-actor.js`
    - `aasc/actors/tts-actor.js`
    - `aasc/actors/reminder-actor.js`
    - `aasc/actors/voice-command-actor.js`
    - `aasc/agents/index.js`
    - `voice-display-node/main.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/spec.md`
    - `docs/design.md`
    - `docs/spec/aasc.md`
    - `docs/design/sherpa-asr.md`
    - `docs/spec/sherpa-asr.md`
    - `docs/task/2026-04-23_Core第六步收口清理.md` (新增)
- ✅ 新增日志大脑（用于大模型问题判断）
  - 需求：增加“类人脑”日志大脑，把日志转换为可用于 LLM 判断问题的结构化上下文
  - 实现：
    - 新增 `src/framework/observability/log-brain.js`
    - 在 `server.js` 集成日志大脑并随日志流实时摄入
    - 新增 `GET /api/logs/brain-summary` 返回日志摘要
    - 新增 `POST /api/logs/brain-judge` 返回 `summary`、`memory`、`prompt`
    - 统一 API 为 `brain-summary/brain-judge`，移除旧命名接口
    - 新增日志大脑设计/实现文档与任务记录
  - 改动文件：
    - `src/framework/observability/log-brain.js` (新增)
    - `server.js`
    - `docs/design/log-brain.md` (新增)
    - `docs/spec/log-brain.md` (新增)
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/task/2026-04-23_日志大脑与LLM判断上下文.md` (新增)
- ✅ Framework 层第五步迁移（基础设施承接）
  - 需求：将 `sub-server`、`log-buffer`、`system-monitor` 从 `core/*` 迁入 Framework 模块目录
  - 实现：
    - `src/framework/cluster/sub-server-manager.js` 承接子服务器管理实现体
    - `src/framework/observability/log-buffer.js` 承接日志缓冲实现体
    - `src/framework/observability/system-monitor.js` 承接系统监控实现体
    - `server.js` 入口直接依赖 Framework 模块路径
    - `core/sub-server.js`、`core/log-buffer.js`、`core/system-monitor.js` 改为兼容转发层
    - 更新分层文档并新增任务记录 `docs/task/2026-04-23_Framework层第五步基础设施迁移.md`
  - 改动文件：
    - `server.js`
    - `src/framework/cluster/sub-server-manager.js`
    - `src/framework/observability/log-buffer.js`
    - `src/framework/observability/system-monitor.js`
    - `core/sub-server.js`
    - `core/log-buffer.js`
    - `core/system-monitor.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-23_Framework层第五步基础设施迁移.md` (新增)
- ✅ App 层第四步迁移（媒体模块承接）
  - 需求：将 `core/media-library.js` 迁入 App 模块目录并保持旧路径兼容
  - 实现：
    - `src/apps/web-mediacenter/modules/media/media-library-app-service.js` 承接媒体库实现体
    - `server.js` 入口直接依赖 App media 模块路径
    - `core/media-library.js` 改为兼容转发层
    - 更新分层文档并新增任务记录 `docs/task/2026-04-23_App层第四步媒体迁移.md`
  - 改动文件：
    - `server.js`
    - `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
    - `core/media-library.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-23_App层第四步媒体迁移.md` (新增)
- ✅ App 层第三步迁移（业务模块承接）
  - 需求：将提醒、语音命令、整点报时、时间监听从 `core/*` 迁入 App 模块目录
  - 实现：
    - `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js` 承接语音命令实现体
    - `src/apps/web-mediacenter/modules/reminder/reminder-app-service.js` 承接提醒实现体
    - `src/apps/web-mediacenter/modules/time/time-announce-app-service.js` 承接整点报时实现体
    - `src/apps/web-mediacenter/modules/time/time-listener-app-service.js` 承接时间监听实现体
    - `server.js` 入口直接依赖 App 模块路径
    - `core/voiceCommand.js`、`core/reminder.js`、`core/timeAnnounce.js`、`core/timeListener.js` 改为兼容转发层
    - 更新分层文档并新增任务记录 `docs/task/2026-04-23_App层第三步迁移.md`
  - 改动文件：
    - `server.js`
    - `src/apps/web-mediacenter/modules/voice/voice-command-app-service.js`
    - `src/apps/web-mediacenter/modules/reminder/reminder-app-service.js`
    - `src/apps/web-mediacenter/modules/time/time-announce-app-service.js`
    - `src/apps/web-mediacenter/modules/time/time-listener-app-service.js`
    - `core/voiceCommand.js`
    - `core/reminder.js`
    - `core/timeAnnounce.js`
    - `core/timeListener.js`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-23_App层第三步迁移.md` (新增)
- ✅ External 层第二步迁移（实现体迁入）
  - 需求：将 ASR/TTS/LLM 实现体从 `core/*` 迁入 `src/external/*`，并保持旧引用兼容
  - 实现：
    - `src/external/asr/asr-service.js` 承接原 `core/asr.js` 实现体并修正模型路径
    - `src/external/tts/tts-service.js` 承接原 `core/tts.js` 实现体并使用 `res/uploads`
    - `src/external/llm/llm-service.js` 承接原 `core/chat.js` 实现体并修正配置路径
    - `core/asr.js`、`core/tts.js`、`core/chat.js` 改为兼容转发层
    - 更新分层文档与 External 迁移说明
    - 新增任务记录 `docs/task/2026-04-23_External层第二步迁移.md`
  - 改动文件：
    - `src/external/asr/asr-service.js`
    - `src/external/tts/tts-service.js`
    - `src/external/llm/llm-service.js`
    - `core/asr.js`
    - `core/tts.js`
    - `core/chat.js`
    - `src/external/README.md`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-23_External层第二步迁移.md` (新增)
- ✅ External 层第一步迁移（入口切换）
  - 需求：在保持接口不变的前提下，把外部能力依赖从 `core/*` 迁到 `src/external/*`
  - 实现：
    - 新增 External 兼容服务：`asr-service`、`tts-service`、`llm-service`
    - `server.js` 依赖切换到 `src/external/*`
    - External 服务第一阶段采用兼容转发（转发到 `core/*`）
    - 更新分层设计与实现文档，补充 External 迁移策略和伪代码
    - 新增任务记录 `docs/task/2026-04-23_External层第一步迁移.md`
  - 改动文件：
    - `server.js`
    - `src/external/asr/asr-service.js` (新增)
    - `src/external/tts/tts-service.js` (新增)
    - `src/external/llm/llm-service.js` (新增)
    - `src/external/README.md`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-23_External层第一步迁移.md` (新增)
- ✅ 资源目录统一到 res（移除旧路径依赖）
  - 需求：将分散的 uploads/temp/models/ssl 目录统一整理，并保持现有运行兼容
  - 实现：
    - `server.js` 资源路径固定为 `res/uploads`、`res/temp/asr`、`res/temp/uploads`、`res/certs`
    - `core/asr.js` 模型目录固定为 `res/models/sensevoice`
    - `core/media-library.js` 上传目录固定识别 `res/uploads`
    - 旧目录 `uploads`、`temp`、`ssl` 中资源迁移到 `res/`
    - 新增 `res/README.md` 目录说明
    - 新增资源目录设计与实现文档
    - 新增任务记录 `docs/task/2026-04-22_资源目录整理.md`
  - 改动文件：
    - `server.js`
    - `core/asr.js`
    - `core/media-library.js`
    - `res/README.md` (新增)
    - `docs/design/resource-layout.md` (新增)
    - `docs/spec/resource-layout.md` (新增)
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/task/2026-04-22_资源目录整理.md` (新增)
- ✅ 新增 server 应用骨架目录
  - 需求：在多应用结构下增加“提供服务”类型应用目录，便于后续独立扩展
  - 实现：
    - 新增 `src/apps/server/` 目录及说明文件
    - 新增 `bootstrap/`、`modules/`、`api/` 子目录说明
    - 更新 `src/README.md` 增加多应用列表
    - 更新分层文档，补充 `server` 目录与定位，并同步将 Capability 命名优化为 External
    - 在实现文档新增 `StartServerApp` 伪代码
    - 新增任务记录 `docs/task/2026-04-22_新增server应用骨架.md`
  - 改动文件：
    - `src/apps/server/README.md` (新增)
    - `src/apps/server/bootstrap/README.md` (新增)
    - `src/apps/server/modules/README.md` (新增)
    - `src/apps/server/api/README.md` (新增)
    - `src/README.md`
    - `docs/design/layered-architecture.md`
    - `docs/spec/layered-architecture.md`
    - `docs/task/2026-04-22_新增server应用骨架.md` (新增)
- ✅ 项目分层结构第一阶段整理（Core/Framework/External/App）
  - 需求：先整理项目结构，统一分层边界，为后续多程序扩展和渐进迁移做准备
  - 实现：
    - 新增 `src/` 分层骨架目录与说明文件：`core`、`framework`、`external`、`apps/web-mediacenter`
    - 新增设计文档 `docs/design/layered-architecture.md`，定义四层职责、依赖规则、迁移策略
    - 新增实现文档 `docs/spec/layered-architecture.md`，补充分层装配和依赖校验伪代码
    - 更新索引 `docs/design.md`、`docs/spec.md` 挂载分层架构文档
    - 新增任务记录 `docs/task/2026-04-22_项目分层结构整理.md`
  - 改动文件：
    - `src/README.md` (新增)
    - `src/core/README.md` (新增)
    - `src/framework/README.md` (新增)
    - `src/external/README.md` (新增)
    - `src/apps/web-mediacenter/README.md` (新增)
    - `src/apps/web-mediacenter/bootstrap/README.md` (新增)
    - `docs/design/layered-architecture.md` (新增)
    - `docs/spec/layered-architecture.md` (新增)
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/task/2026-04-22_项目分层结构整理.md` (新增)
- ✅ Auto-Brain 独立分层文档（与 AASC 解耦）
  - 需求：将示例性的“条件反射层/小脑/大脑”升级为可工程落地的通俗分层，并明确 AASC 仅作为消息总线
  - 实现：
    - 新增 `docs/design/auto-brain.md`，定义 Input/Fast Decision/Action/Tuning/Planning/Guard/Monitor 七层职责与边界
    - 新增 `docs/spec/auto-brain.md`，补充伪代码实现：主流程、原型注册扩展点、数据契约、失败回滚、AASC 主题协作
    - `aasc/message-bus.js` 增加多运行时能力：`registerRuntime`、`unregisterRuntime`、`listRuntimes`、`buildRuntimeTopic`、`subscribeRuntime`、`publishRuntime`
    - `aasc/message-bus.js` 增加跨设备能力：`registerDeviceTransport`、`receiveRemoteRuntimeMessage`、`targetDeviceId/targetRuntimeId` 路由、`broadcastDevices` 广播
    - `server.js` 新增 WebSocket 设备桥接路径 `/runtime-bridge`，支持 runtime envelope 上下行与心跳
    - 消息统计增加 `messagesByRuntime` 与 `runtimeCount`，支持按 runtime 观测总线流量
    - 消息统计增加 `runtimeMessagesByDevice` 与 `deviceTransportCount`，支持按设备观测跨设备投递
    - `auto-brain/src/adapters/aasc-bus-adapter.js` 与 `auto-brain/src/orchestration/behavior-orchestrator.js` 改为 runtimeId 隔离主题
    - 新增 `auto-brain/` 代码骨架：Orchestrator、AASC 适配器、RuleTable、ActionDispatcher、PolicyGate、PlanningAdapter 等模块
    - 清理 `docs/design/aasc.md` 与 `docs/spec/aasc.md` 中混入的 Auto-Brain 分层内容，恢复 AASC 聚焦消息总线定位
    - 更新索引 `docs/design.md` 与 `docs/spec.md`，将 Auto-Brain 作为独立模块挂载
    - 更新任务记录 `docs/task/2026-04-22_AASC分层与命名优化.md`
  - 改动文件：
    - `aasc/message-bus.js`
    - `server.js`
    - `auto-brain/README.md` (新增)
    - `auto-brain/src/index.js` (新增)
    - `auto-brain/src/orchestration/behavior-orchestrator.js` (新增)
    - `auto-brain/src/adapters/aasc-bus-adapter.js` (新增)
    - `auto-brain/src/core/prototype-registry.js` (新增)
    - `auto-brain/src/contracts/signal-event.js` (新增)
    - `auto-brain/src/contracts/execution-action.js` (新增)
    - `auto-brain/src/contracts/outcome-feedback.js` (新增)
    - `auto-brain/src/contracts/strategy-draft.js` (新增)
    - `auto-brain/src/contracts/strategy-profile.js` (新增)
    - `auto-brain/src/input/input-normalizer.js` (新增)
    - `auto-brain/src/fast-decision/rule-table.js` (新增)
    - `auto-brain/src/fast-decision/fast-decision-engine.js` (新增)
    - `auto-brain/src/action/action-dispatcher.js` (新增)
    - `auto-brain/src/tuning/tuning-engine.js` (新增)
    - `auto-brain/src/planning/planning-adapter.js` (新增)
    - `auto-brain/src/guard/policy-validator.js` (新增)
    - `auto-brain/src/guard/policy-gate.js` (新增)
    - `auto-brain/src/monitor/metrics-recorder.js` (新增)
    - `docs/design/auto-brain.md` (新增)
    - `docs/spec/auto-brain.md` (新增)
    - `docs/design/aasc.md`
    - `docs/spec/aasc.md`
    - `docs/design.md`
    - `docs/spec.md`
    - `docs/task/2026-04-22_AASC分层与命名优化.md`
    - `docs/todo.md`
- ✅ 新增服务端 ASR 压测脚本
  - 功能：提供 `scripts/asr-stress-test.js`，用于直接压测 `/api/asr/recognize` 并观察 RSS / Heap / External / ArrayBuffers 变化
  - 实现：
    - 支持 `--url`、`--file`、`--total`、`--concurrency`、`--timeout`、`--output-every`、`--retry-429` 参数
    - 未提供音频文件时自动生成 16kHz 单声道 WAV 样本
    - 手动构造 multipart/form-data 请求体，兼容当前 ASR 上传接口
    - 输出 success / ignored / busy429 / failed、平均延迟、最大延迟和内存快照
  - 改动文件：
    - `scripts/asr-stress-test.js` (新增)
    - `docs/design/sherpa-asr.md` (补充压测工具设计)
    - `docs/spec/sherpa-asr.md` (补充压测脚本伪代码)
    - `docs/task/2026-04-19_ASR压测脚本.md` (新增任务记录)
- ✅ ASR 压测脚本联动服务端 system-stats
  - 功能：压测 `/api/asr/recognize` 的同时自动采集 `/api/system-stats`，直接输出服务端 RSS / External / ArrayBuffers 变化曲线
  - 实现：
    - 抽象通用 HTTP 请求函数，复用到 ASR 请求和 system-stats 采样
    - 新增 `--stats-interval` 和 `--no-system-stats` 参数
    - 压测结束后输出服务端峰值指标和 ASCII 曲线，便于快速判断内存是否进入平台期
  - 改动文件：
    - `scripts/asr-stress-test.js` (联动 system-stats、峰值统计、ASCII 曲线)
    - `docs/design/sherpa-asr.md` (补充联动监控设计)
    - `docs/spec/sherpa-asr.md` (补充联动采样伪代码)
    - `docs/task/2026-04-19_ASR压测联动system-stats.md` (新增任务记录)
- ✅ 子显示端 TUI 添加系统监控面板
  - 需求：子显示端 TUI 界面添加 CPU 和内存监控信息
  - 实现：
    - SubDisplayTUI 布局从两列改为三列：连接状态(34%) | 录音状态(33%) | 系统监控(33%)
    - 新增 monitorBox 面板，显示 CPU 使用率、核心数、负载、内存使用率、已用/总量、进程 RSS、堆内存、系统运行时间、进程运行时间
    - CPU/内存使用率超过阈值时颜色变化（>50% 黄色，>80% 红色）
    - 集成 core/system-monitor.js，每5秒采集一次数据并更新面板
    - 新增 formatUptime/formatMemory 辅助函数
    - 退出时正确停止 SystemMonitor
  - 改动文件：
    - `voice-display-node/tui.js` (添加 monitorBox、updateSystemStats、formatUptime、formatMemory)
    - `voice-display-node/main.js` (集成 SystemMonitor)
    - `docs/design/tui.md` (更新子显示端布局图)
    - `docs/spec/tui.md` (更新伪代码)

### Bug 修复
- ✅ 服务端语音识别 RSS 持续上涨修复
  - 问题：服务端 ASR 高频调用时 RSS 持续上涨，长时间运行后不回落
  - 原因分析：
    1. `core/asr.js` 共享单个 `OfflineRecognizer`，但没有限制并发请求，同时创建多个 stream 会让 native 资源持续堆积
    2. 识别任务结束后虽然调用了 `stream.destroy()`，但缺少统一的 finally 生命周期管理，大数组和中间引用释放不够及时
    3. `/api/asr/recognize` 的临时文件清理逻辑分散，错误和高负载场景下不利于统一回收
  - 修复：
    - `core/asr.js`：为识别请求增加串行队列和最大排队数量，拆分 `performRecognition()`，统一在 `finally` 中释放 stream 和 samples 引用，并在空闲时按批次检查 RSS/ArrayBuffers 后触发 GC
    - `server.js`：新增 `cleanupTempFile()` 统一清理 ASR 上传临时文件；当队列过长时返回 429，避免请求无限堆积
    - `core/asr.js`：将 ASR 主动 GC 的 RSS 触发阈值从 256MB 提高到 1GB，减少正常波动时的过度 GC
  - 改动文件：
    - `core/asr.js` (串行识别队列、stream 安全释放、按批次 GC)
    - `server.js` (ASR 临时文件统一清理、繁忙保护)
    - `docs/design/sherpa-asr.md` (新增设计文档)
    - `docs/spec/sherpa-asr.md` (更新伪代码)
    - `docs/task/2026-04-19_服务端语音识别RSS上涨修复.md` (新增任务记录)
- ✅ 服务端 RSS 内存持续增长修复（第三轮 - 根治）
  - 问题：RSS 持续增长不回落，即使 Heap 正常，堆外内存持续累积
  - 根本原因：
    1. `parseMultipart()` 手动解析将整个上传体（最大200MB）缓存到内存 Buffer，是 RSS 暴涨的最大来源
    2. `StateManager._cloneValue()` 对 Map/Set 做深拷贝存入历史记录，每次状态变更都复制整个 Map，内存翻倍且不释放
    3. `RateLimitMiddleware` 的 `requests` Map 只增不减，断开的客户端请求记录永不清理
    4. `TimeoutMiddleware` 的 `setTimeout` 在 next() 完成后不清理，造成定时器泄漏
    5. SMB `getFileStream()` 的 `buffer.slice()` 返回的是原 Buffer 的视图而非独立拷贝，原 Buffer 无法被 GC
    6. `HttpProvider` 缓存 Map 无过期清理，只增不减
    7. 显示端断开时 `muteState.previousVolumes` 条目未清理
  - 修复：
    - `server.js`：用 `multer` 替代 `parseMultipart()`，文件直接写入临时目录再 rename，不经过内存；媒体库上传也改用 multer；添加临时上传文件定期清理
    - `aasc/components/state-manager.js`：`_cloneValue()` 对 Map/Set 改为轻量快照（只记录 size 和 keys），不再深拷贝；历史记录淘汰时主动 clear 旧 Map/Set
    - `aasc/middleware/index.js`：`RateLimitMiddleware` 添加每5分钟清理过期客户端记录；`TimeoutMiddleware` 在 next() 完成后 clearTimeout
    - `core/media-library.js`：SMB `getFileStream()` 改用 `Buffer.from()` 创建独立拷贝后立即释放原 Buffer 引用；添加 `error` 事件清理；`HttpProvider` 添加缓存过期定期清理和 disconnect 时清理定时器
    - `server.js`：显示端断开时清理 `muteState.previousVolumes` 对应条目
  - 改动文件：
    - `server.js` (multer 替代 parseMultipart、临时文件清理、muteState 清理)
    - `aasc/components/state-manager.js` (轻量快照替代深拷贝)
    - `aasc/middleware/index.js` (RateLimit 清理、Timeout clearTimeout)
    - `core/media-library.js` (SMB Buffer 独立拷贝、HttpProvider 缓存清理)
- ✅ 服务端 RSS 内存持续增长修复（第二轮优化）
  - 问题：服务端 RSS 达到 809.4MB，Heap 仅 13.2MB，堆外内存泄漏严重
  - 原因分析：
    1. SMB `getFileStream()` 将整个文件一次性 push 到 Readable stream，客户端断开时 Buffer 引用未释放
    2. 文件上传后 `file.data` Buffer 引用未及时置 null，大文件上传后内存持续占用
    3. ASR `readWavFile()` 使用 `Buffer.from(buffer.slice())` 创建不必要的 Buffer 拷贝，内存翻倍
    4. WebSocket 关闭时未调用 `removeAllListeners()`，事件监听器闭包持有引用阻止 GC
    5. 媒体代理路由缺少 Content-Length 和 Accept-Ranges 头，浏览器无法正确处理视频
    6. ASR 临时文件无定期清理机制
  - 修复：
    - `core/media-library.js`：SMB `getFileStream()` 改为 64KB 分块流式传输，添加 `end`/`close` 事件释放 Buffer 引用；`uploadFile()` 写入文件后 `file.data = null`
    - `core/asr.js`：`readWavFile()` 和 `convertAudioFile()` 直接从原始 buffer 读取数据，移除 `Buffer.from(buffer.slice())` 中间拷贝
    - `server.js`：WebSocket `close` 事件中添加 `ws.removeAllListeners()`；代理路由添加 `Accept-Ranges`/`Content-Length` 头；上传路由写入文件后 `file.data = null`；内存告警增加连接状态信息；添加 ASR 临时文件定期清理（10分钟间隔，30分钟过期）
  - 改动文件：
    - `core/media-library.js` (SMB 流式分块、上传 Buffer 释放)
    - `core/asr.js` (移除 Buffer 拷贝)
    - `server.js` (WS 清理、代理头、Buffer 释放、ASR 清理、内存诊断)
- ✅ 服务端 RSS 内存持续增长修复
  - 问题：服务端长时间运行后 RSS 持续增长到 582MB+，而 Heap 仅 14.8MB，说明是堆外（native/C++）内存泄漏
  - 原因分析：
    1. ASR 识别时 `recognizer.createStream()` 创建的 native stream 对象未调用 `destroy()` 释放，每次语音识别都泄漏 C++ 内存
    2. SMB 媒体库 `getFileStream()` 将整个文件读入 Buffer（native 内存），大视频文件可达数百 MB，且 Buffer 引用未及时释放
    3. 媒体代理 proxy 端点 `stream.pipe(res)` 无错误处理，客户端断开时 stream 不会被销毁，native 内存无法释放
    4. `parseMultipart()` 无大小限制，整个请求体缓冲到内存
    5. `express.json({ limit: '500mb' })` 限制过大
    6. `deviceEventDebounce` Map 无定期清理
  - 修复：
    - `core/asr.js`：`recognize()` 方法在获取结果后和异常时均调用 `stream.destroy()` 释放 native 对象；`readWavFile()` 使用 `Buffer.from()` 复制音频数据，避免持有完整 WAV 文件引用
    - `core/media-library.js`：SMB `getFileStream()` 改用延迟读取的 Readable stream，读取后立即释放 Buffer 引用
    - `server.js`：媒体代理 proxy 端点添加 `req.on('close')` 清理 stream、`stream.on('error')` 错误处理；`parseMultipart()` 添加 200MB 大小限制和提前终止；`express.json` 限制从 500MB 降为 50MB；内存监控增加 ArrayBuffers 指标和 RSS 超 500MB 告警+自动 GC；`deviceEventDebounce` 添加每 5 分钟定期清理
    - `package.json`：启动参数添加 `--expose-gc` 启用手动 GC
  - 改动文件：
    - `core/asr.js` (stream 释放、Buffer 复制)
    - `core/media-library.js` (SMB stream 延迟读取)
    - `server.js` (proxy 清理、上传限制、内存监控、debounce 清理)
    - `package.json` (--expose-gc)
- ✅ 去掉控制端聊天界面里的系统 tips
  - 问题：`addSystemMessage()` 每次调用都在聊天消息容器中创建 `.chat-message.system` DOM 元素，系统提示消息（如"已进入私聊模式"、"正在搜索: xxx"等）不断累积，造成 DOM 节点持续增长
  - 修复：`addSystemMessage()` 只保留 `window.showToast()` 提示，不再向聊天消息容器中追加系统消息 DOM 元素
  - 改动文件：
    - `public/js/chat.js` (addSystemMessage 移除 DOM 操作)
- ✅ 去掉服务端 TUI 界面
  - 问题：服务端 TUI 界面基于 blessed 库，长时间运行存在内存泄漏（blessed 内部缓冲区无限膨胀），且服务端通常以后台服务运行，TUI 界面实际用处不大
  - 修复：
    - 从 server.js 中移除 ServerTUI、installConsoleRedirect 的引入和所有 TUI 相关调用
    - 简化 `log()`/`logError()` 函数，直接使用 console.log/error 输出
    - 从 package.json 中移除 blessed 依赖
    - 移除 `--no-tui` 启动参数（不再需要）
    - 保留 `core/tui.js` 文件（子显示端 SubDisplayTUI 仍使用类似结构）
  - 改动文件：
    - `server.js` (移除 TUI 集成)
    - `package.json` (移除 blessed 依赖，移除 --no-tui 参数)
- ✅ TUI 模式内存泄漏修复
  - 问题：TUI 模式长时间运行后内存持续增长，blessed.log 内部缓冲区无限膨胀
  - 原因：
    - blessed.log 组件虽然设置了 bufferLength，但内部 `_clines` 缓存和渲染管线不会完全释放旧内容引用
    - ServerTUI 的 logBuffer 使用 `slice()` 创建新数组，旧数组引用可能延迟回收
    - SubDisplayTUI 完全没有日志缓冲管理，logBox 内容无限增长
    - `_reapplyFilter()` 重新写入所有历史日志（最多 2000 条），不限制数量
    - `levelMap` 每次 addLog 调用都重新创建对象，增加 GC 压力
    - `destroy()` 方法清理不彻底，未清除定时器和组件引用
  - 修复：
    - 新增 `_trimLogBox()` 方法，当 logBox 内部行数超过 `maxLogLines * 1.5` 时，清空并从 logBuffer 重新写入最近 `maxLogLines` 条日志
    - 新增 `_startTrimTimer()` 定时器，每 60 秒执行一次 `_trimLogBox()`
    - `addLog()` 中每 200 条日志触发一次 `_trimLogBox()`
    - `logBuffer` 裁剪改用 `splice()` 原地修改，避免创建新数组
    - `LEVEL_MAP` 提升为模块级常量，避免每次调用重复创建
    - `_reapplyFilter()` 限制只重新写入最近 `maxLogLines` 条日志
    - SubDisplayTUI 新增 `logBuffer`/`maxLogBuffer` 日志缓冲管理
    - `destroy()` 方法清除所有定时器、清空缓冲区、置空组件引用
  - 改动文件：
    - `core/tui.js` (ServerTUI 内存泄漏修复)
    - `voice-display-node/tui.js` (SubDisplayTUI 内存泄漏修复)
    - `docs/spec/tui.md` (更新伪代码)

### 新功能
- ✅ TUI 系统监控和日志筛选
  - 需求：服务端 TUI 上也需要显示系统监控数据和日志筛选功能
  - 实现：
    - TUI 状态面板新增系统监控区域，显示 CPU 使用率（带颜色）、内存使用率（带颜色）、系统运行时间、负载均值
    - TUI 日志面板新增级别筛选功能，支持 F1-F5 快捷键切换筛选级别
    - F1: 全部日志，F2: 错误日志，F3: 警告日志，F4: 信息日志，F5: 调试日志
    - 日志缓冲区存储最近 2000 条日志，切换筛选时重新渲染
    - 状态面板和设备列表高度调整为 50%，为系统监控数据留出空间
    - systemMonitor.onStats 回调同时推送给 TUI 和控制端
  - 改动文件：
    - `core/tui.js` (添加 updateSystemStats、setLogFilter、logBuffer，调整布局)
    - `server.js` (systemMonitor.onStats 推送 TUI)

- ✅ 服务端启动时直接修改 voice-display-node 配置
  - 需求：服务端启动时直接修改配置文件，不等子显示端连接时才推送
  - 实现：
    - 将 `updateVoiceDisplayConfig` 调用从 `server.listen` 回调内移到 `server.listen` 之前
    - 服务端启动时立即检测本地 IP 并写入 voice-display-node/config.json
    - Go 版 voice-display 同步添加 `handleConfigUpdate` 方法
  - 改动文件：
    - `server.js` (updateVoiceDisplayConfig 提前到 listen 之前)
    - `voice-display/main.go` (添加 handleConfigUpdate 方法)

- ✅ 日志筛选功能
  - 需求：控制端日志面板支持多维度筛选，方便快速定位问题
  - 实现：
    - 服务端新增 `core/log-buffer.js`，结构化日志缓冲区，支持按搜索内容、级别、设备、标签、时间范围筛选
    - 服务端新增 `core/system-monitor.js`，系统 CPU 和内存监控数据采集
    - 服务端 `server.js` 集成日志缓冲区和系统监控，新增 `/api/logs` 和 `/api/system-stats` API 端点
    - 服务端日志通过 WebSocket 实时广播给控制端（serverLog、logHistory、systemStats 消息类型）
    - 客户端新增 `public/js/log-viewer.js`，日志查看器组件，支持搜索框、级别筛选、设备筛选、标签筛选、时间范围筛选
    - 客户端系统状态面板显示 CPU 使用率、内存使用率、进程内存、堆内存、系统运行时间、进程运行时间
    - 客户端日志面板支持自动滚动、清除筛选、清空日志
    - 侧边栏新增"日志"导航项，日志面板包含系统状态和日志筛选两个区域
  - 改动文件：
    - `core/log-buffer.js` (新增，日志缓冲区)
    - `core/system-monitor.js` (新增，系统监控)
    - `server.js` (集成日志缓冲区和系统监控，新增 API 端点)
    - `public/js/log-viewer.js` (新增，客户端日志查看器)
    - `public/js/websocket.js` (添加日志和系统状态消息处理)
    - `public/js/main.js` (初始化 LogViewer)
    - `public/upload.html` (添加日志导航项和日志面板 HTML)
    - `public/css/upload.css` (添加日志面板样式)

### Bug 修复
- ✅ 服务端启动时未更新 voice-display-node 配置
  - 问题：`getLocalIP()` 函数有硬编码返回值 `return '192.168.1.39'`，导致实际 IP 检测代码永远不会执行，voice-display-node 配置中的服务器地址可能不正确
  - 修复：
    - 移除 `getLocalIP()` 中的硬编码返回值，恢复自动 IP 检测
    - 子显示端连接时服务端主动推送 `configUpdate` 消息，包含最新的服务器地址和显示端 ID
    - voice-display-node 新增 `handleConfigUpdate` 方法，收到配置更新后写入本地 config.json
  - 改动文件：
    - `server.js` (修复 getLocalIP，子显示端连接时推送 configUpdate)
    - `voice-display-node/main.js` (添加 configUpdate 消息处理)

- ✅ 设备列表文本未对齐，能力显示使用缩写
  - 问题：TUI 设备列表中类型列宽度不足导致中文对齐错乱，能力显示使用 M/P/R/A/T 缩写不直观
  - 修复：
    - 类型列宽度从 8 调整为 10，确保中文"子显示"/"显示端"对齐
    - `formatCapabilities` 函数改用中文标签（媒体/播放/录音/识别/文字）替代英文缩写
  - 改动文件：
    - `core/tui.js` (修改 formatCapabilities 和 updateDeviceList)

- ✅ TUI 日志窗口支持方向键滚动（兼容 tmux 远程环境）
  - 需求：在 tmux 远程会话中使用方向键滚动日志窗口
  - 实现：
    - logBox 添加 `focusable: true` 属性，使其可获取焦点
    - 初始化时自动聚焦 logBox
    - 新增 `_bindScrollKeys()` 方法，通过 `screen.key()` 在屏幕级别绑定方向键
    - 支持 up/down 逐行滚动、pageup/pagedown 翻页、home/end 跳转首尾
    - 使用屏幕级别键绑定而非元素级别，确保在 tmux 等远程环境下方向键始终生效
  - 改动文件：
    - `core/tui.js` (ServerTUI 添加滚动键绑定)
    - `voice-display-node/tui.js` (SubDisplayTUI 添加滚动键绑定)
    - `docs/spec/tui.md` (更新伪代码)
- ✅ TUI 设备列表文本对齐修复
  - 需求：设备列表中含中文的列（类型）与表头未对齐
  - 原因：`padEnd()` 按字符数填充，中文字符在终端占2列宽度，导致实际显示宽度不一致
  - 实现：
    - 新增 `displayWidth()` 函数，计算字符串的终端显示宽度（CJK/全角/Emoji 算2列，其余算1列）
    - 新增 `padEndDisplay()` 函数，按终端显示宽度填充空格
    - 设备列表各列改用 `padEndDisplay()` 替代 `padEnd()`
    - 类型列宽度从 6 调整为 8（3个中文字=6列+2列间距）
  - 改动文件：
    - `core/tui.js` (添加 displayWidth/padEndDisplay，修改 updateDeviceList)
    - `docs/spec/tui.md` (更新伪代码)
- ✅ 服务端和子显示端 TUI 界面显示
  - 需求：服务端和子显示端使用 TUI 界面替代 console.log 输出，提供结构化信息面板
  - 实现：
    - 使用 blessed 库实现终端用户界面
    - 服务端 TUI（ServerTUI）：标题栏、系统状态面板、设备列表表格、事件日志面板
    - 子显示端 TUI（SubDisplayTUI）：标题栏、连接状态面板、录音状态面板、事件日志面板
    - 日志分类颜色编码（连接/断开/语音/TTS/提醒/设备/错误等）
    - 支持 `--no-tui` 参数禁用 TUI，回退到纯日志模式
    - 服务端定时刷新系统状态和设备列表
    - 子显示端实时更新连接状态和录音状态
    - 所有 console.log/error 替换为 log()/logError() 抽象函数
  - 改动文件：
    - `core/tui.js` (新增，ServerTUI 实现)
    - `voice-display-node/tui.js` (新增，SubDisplayTUI 实现)
    - `server.js` (集成 TUI，替换 console.log)
    - `voice-display-node/main.js` (集成 TUI，替换 console.log)
    - `package.json` (添加 blessed 依赖)
    - `voice-display-node/package.json` (添加 blessed 依赖)
    - `docs/design/tui.md` (新增，TUI 设计文档)
    - `docs/spec/tui.md` (新增，TUI 实现文档)
    - `docs/task/2026-04-16_TUI界面实现.md` (新增，任务文档)
- ✅ 合并 DisplayList 和 DeviceTree 组件，支持视图切换
  - 需求：将 display-list.js 和 device-tree.js 合并为一个组件，支持列表视图和树形视图切换
  - 实现：
    - 创建新的 device-list.js 组件，合并两个组件的所有功能
    - 新增 viewMode 属性，支持 'tree' 和 'list' 两种视图模式
    - 新增视图切换按钮，点击可在树形视图和列表视图之间切换
    - 统一数据管理，保留选择模式（单选/全选/自适应）功能
    - 保留树形视图的所有功能：设备设置、事件指令、浏览器信息、设备能力
    - 兼容性：同时设置 window.DisplayList、window.DeviceList、window.DeviceTree
  - 改动文件：
    - `public/js/device-list.js` (新增，合并 display-list.js 和 device-tree.js)
    - `public/js/display-list.js` (已删除)
    - `public/js/device-tree.js` (已删除)
    - `public/upload.html`
    - `public/css/upload.css`
    - `public/js/websocket.js`
    - `public/js/main.js`
    - `docs/spec/device-list.md` (新增)
- ✅ 设备树添加设备能力下拉菜单
  - 需求：在设备列表的浏览器信息后面添加设备能力下拉菜单，可以查看和设置能力
  - 实现：
    - 在 device-tree.js 中添加设备能力节点，位于浏览器信息节点后面
    - 添加 buildCapabilitiesChildren 方法构建能力子节点
    - 添加 renderCapabilityControl 方法渲染能力下拉菜单
    - 添加 updateCapability 方法通过 WebSocket 更新能力设置
    - 支持的能力：媒体渲染、语音播放、语音录音、语音识别、文本显示
  - 改动文件：
    - `public/js/device-tree.js`
    - `public/css/upload.css`
    - `docs/spec/device-tree.md`
- ✅ 控制端设备能力查看与设置功能完善
  - 需求：控制端可以查看和设置设备能力
  - 实现：
    - 设备列表中显示能力图标，包括媒体渲染、语音播放、语音录音、语音识别、文本显示
    - 点击设备旁的⚙️按钮可打开能力设置弹窗
    - 能力设置弹窗支持勾选/取消各项能力
    - 保存后实时同步到显示端
  - 改动文件：
    - `public/js/display-list.js`
    - `docs/spec/display-capability.md`
- ✅ 语音输入排队、提醒确认增强与天气回退
  - 需求：完成 todo 中语音输入排队、提醒确认、录音开关、提醒模板、天气城市回退与 capabilities 路由修复
  - 实现：
    - `core/voiceCommand.js` 新增 `enqueueVoiceInput`，按显示端串行处理语音输入
    - 提醒确认文案加入今天/明天的 24 小时制时间，去除 5 秒自动确认
    - 提醒确认新增防重入保护，避免重复确认重复添加
    - 提醒创建成功后增加语音提示，取消时也有语音反馈
    - 新增“开启录音 / 关闭录音 / 开始录音 / 停止录音”语音指令
    - 新增提醒模板、前缀、后缀配置
    - 天气查询新增城市白名单和默认城市回退，并清洗中文标点
    - AASC 新增 `capabilities` 路由与状态更新逻辑
    - Node 子显示端新增 `setRecording` 控制处理，支持暂停/恢复录音
  - 改动文件：
    - `core/voiceCommand.js`
    - `aasc/agents/index.js`
    - `aasc/actor-adapter.js`
    - `aasc/components/message-dispatcher.js`
    - `voice-display-node/main.js`
    - `core/config.js`
    - `server.js`
    - `docs/spec/voiceCommand.md`
    - `docs/spec/voice-display.md`
    - `docs/spec/aasc.md`
    - `docs/spec/config.md`
    - `docs/design/reminder.md`
    - `docs/design/aasc.md`
    - `docs/task/2026-04-15_语音队列提醒确认与天气回退.md`
    - `docs/todo.md`

### Bug 修复
- ✅ TUI 模式下禁用直接 console 输出
  - 问题：部分模块/第三方库仍会 `console.log/error` 直接写 stdout/stderr，导致 blessed TUI 渲染被破坏（文本串到其他面板/边框溢出）
  - 修复：在 TUI 启用时重定向 `console.log/info/warn/error/debug` 到 TUI 日志；同时 `logError()` 在 TUI 模式下不再写 stderr
  - 改动文件：
    - `core/console-redirect.js` (新增，console 重定向工具)
    - `server.js`
    - `voice-display-node/main.js`
    - `docs/design/tui.md`
    - `docs/spec/tui.md`
- ✅ 修复 TUI 设备列表表格渲染错误
  - 问题：设备数据中 `id` 属性为 `undefined` 时，blessed Table 组件报错 `TypeError: Cannot read properties of undefined (reading 'length')`
  - 修复：
    - 在 `updateDeviceList` 方法中添加完善的防御性检查
    - 检查 `devices` 参数是否存在且为数组
    - 使用 `filter(d => d != null)` 过滤掉 null 和 undefined 元素
    - 使用 `String()` 转换确保所有值都是字符串
    - 为 `id` 和 `ip` 添加更严格的检查 `(d.id != null && d.id !== undefined)`
  - 改动文件：
    - `core/tui.js` - updateDeviceList 方法添加完善的防御性检查
- ✅ 修复 AASC 无法处理 capabilities 消息
  - 问题：子显示端声明能力后，AASC 报错 `No handler found for type: capabilities`
  - 修复：在 message dispatcher、actor adapter、display render agent 中补齐 `capabilities` 处理链路
- ✅ 显示端分布式能力
  - 需求：每个显示端可以声明自身能力，服务端根据能力进行智能路由
  - 实现：
    - 新增 DisplayCapabilities 数据结构（mediaRendering、voicePlayback、voiceRecording、voiceRecognition、displayText）
    - 新增 DEFAULT_CAPABILITIES 和 SUB_DISPLAY_CAPABILITIES 常量
    - 服务端 createDisplayState 添加 capabilities 字段
    - 服务端新增 capabilities 消息处理（显示端声明能力）
    - 服务端新增 updateCapabilities 消息处理（控制端修改能力）
    - 服务端新增 capabilitiesUpdated 消息（通知显示端能力已更新）
    - 服务端新增 getDisplayCapabilities、getDisplaysWithCapability、sendToDisplaysWithCapability 辅助函数
    - TTS 广播（broadcastAll）只发送给有 voicePlayback 能力的显示端
    - TTS 指定显示端播放时检查 voicePlayback 能力
    - TTS stop 只发送给有 voicePlayback 能力的显示端
    - 显示端新增 detectCapabilities 自动检测能力（getUserMedia、ASR可用性）
    - 显示端新增 declareCapabilities 声明能力
    - 显示端新增 handleCapabilitiesUpdated 处理能力更新
    - 显示端 startVoiceRecording 检查 voiceRecording 能力
    - 控制端显示端列表新增能力图标（🖥️🔊🎙️🧠）
    - 控制端新增能力编辑弹窗（showCapabilityEditor）
    - 地图数据 API 和 actors API 根据能力动态生成能力列表
    - 子显示端（Node.js/Go/C#）连接时自动声明 SUB_DISPLAY_CAPABILITIES
  - 改动文件：
    - server.js - 能力常量、状态扩展、消息处理、路由辅助函数、TTS路由、地图数据API
    - public/display.html - 能力检测、声明、更新处理、录音能力检查
    - public/js/display-list.js - 能力图标、能力编辑弹窗
    - public/css/upload.css - 能力图标样式、能力编辑弹窗样式
    - voice-display-node/main.js - 子显示端能力声明
    - voice-display/main.go - 子显示端能力声明(Go)
    - voice-display-cs/VoiceDisplay.cs - 子显示端能力声明(C#)
    - docs/design/display-capability.md - 设计文档
    - docs/spec/display-capability.md - 实现文档

### 新功能
- ✅ 子显示端播放语音时暂停录音
  - 需求：子显示端播放TTS语音时暂停录音，防止麦克风拾取TTS输出造成回声反馈
  - 实现：
    - AudioPlayer 添加 onPlayStart/onPlayEnd 回调，播放队列开始时触发 onPlayStart，队列结束时触发 onPlayEnd
    - AudioPlayer 添加 IsPlaying()/isCurrentlyPlaying() 方法和 playing 状态
    - AudioRecorder 添加 Pause()/Resume()/IsPaused() 方法（Go）和 pause()/resume()/isPaused() 方法（Node.js）
    - 录音暂停时重置语音累积状态（hasSpeech、speechSamples、silenceFrameCount），防止暂停前的片段被误发
    - VoiceDisplay 设置播放回调：onPlayStart → recorder.Pause()，onPlayEnd → recorder.Resume()
    - Go 和 Node.js 两种实现均已更新
  - 改动文件：
    - voice-display/audio.go - 添加 playing 字段、onPlayStart/onPlayEnd 回调、IsPlaying/SetOnPlayStart/SetOnPlayEnd 方法
    - voice-display/recorder.go - 添加 paused 字段、Pause/Resume/IsPaused 方法、onRecvFrames 暂停检查
    - voice-display/main.go - 添加 setupPlaybackPause 方法、asrReadyChan 通道
    - voice-display-node/audio-player.js - 添加 onPlayStart/onPlayEnd 回调
    - voice-display-node/audio-recorder.js - 添加 paused 字段、pause/resume/isPaused 方法、data 事件暂停检查
    - voice-display-node/audio-recorder-pv.js - 添加 paused 字段、pause/resume/isPaused 方法、recordLoop 暂停检查
    - voice-display-node/main.js - 添加 setupPlaybackPause、waitForASRReady 方法
    - docs/spec/voice-display.md - 更新伪代码

- ✅ ServerASR checkReady 就绪后自动开始录音
  - 需求：子显示端启动时如果ASR不可用，后续ASR就绪后应自动开始语音识别
  - 实现：
    - Node.js：ServerASR 构造函数中 checkReady() 是异步调用但未 await，导致 isReady() 始终返回 false
    - 修复：start() 中改为 await this.asr.checkReady()，确保就绪状态正确
    - 添加 waitForASRReady() 方法：ASR 不可用时每5秒轮询检查，就绪后自动启动语音识别
    - ServerASR 添加 waitForReady() 方法，支持 Promise 方式等待就绪
    - Go：添加 waitForASRReady() 方法，使用 ticker 每5秒检查 asr.RefreshStatus()
    - stop() 中清理轮询定时器
  - 改动文件：
    - voice-display-node/asr-client.js - 添加 waitForReady 方法
    - voice-display-node/main.js - 修复 checkReady 异步问题，添加 waitForASRReady 方法
    - voice-display/main.go - 添加 waitForASRReady 方法、asrReadyChan 通道
    - docs/spec/voice-display.md - 更新伪代码

### 新功能
- ✅ 天气API地址日志打印
  - 需求：获取天气时打印天气API的地址，方便调试
  - 实现：在 handleWeatherCommand 函数中添加 console.log 打印天气API URL
  - 改动文件：
    - core/voiceCommand.js - 添加天气API地址日志打印

- ✅ 语音输入日志打印显示端IP
  - 需求：服务端打印语音输入时带上显示端的IP地址
  - 实现：在 VoiceCommandAgent.processVoiceInput 中添加日志打印，格式为 `[语音输入] 显示端 {displayId} ({displayIP}): {voiceText}`
  - 改动文件：
    - aasc/agents/index.js - VoiceCommandAgent.processVoiceInput 添加日志打印

- ✅ 子显示端3分钟不在线自动执行离线指令
  - 需求：子显示端3分钟不在线时，自动执行离线指令
  - 实现：
    - displayClients 中添加 lastSeen 时间戳，记录最后活跃时间
    - 收到消息时更新 lastSeen 时间戳
    - 子显示端添加心跳机制，每60秒发送一次心跳消息
    - 服务端添加定时器（每30秒检查一次），检测子显示端是否超过3分钟未响应
    - 超时时执行离线指令（executeDeviceEvent）并断开连接
  - 改动文件：
    - server.js - 添加 lastSeen 时间戳和心跳检测定时器
    - voice-display-node/main.js - 添加心跳发送机制
    - aasc/system/websocket-system.js - 处理心跳消息

### Bug 修复
- ✅ 子显示端语音输入未被处理
  - 问题：子显示端（voice-display-node）发送的语音输入（voiceInput）消息没有被处理成语音命令
  - 原因：
    - voiceInput 消息被错误地路由到 display-render-actor，而不是 voice-command-actor
    - VoiceCommandAgent 缺少 processVoiceInput 方法
    - ActorFactory 配置错误，将 voiceInput 分配给了 DisplayRenderAgent
  - 修复：
    - 修改 message-dispatcher.js，将 voiceInput 消息路由到 voice-command-actor
    - 在 voice-command-actor.js 中添加 handleVoiceInput 方法
    - 在 VoiceCommandAgent 中添加 processVoiceInput 方法，调用 voiceCommand.processVoiceCommand
    - 修改 ActorFactory.createVoiceCommandActor，添加 voiceInput 支持到 supportedTypes 和 actionMap
    - 从 ActorFactory.createDisplayRenderActor 中移除 voiceInput 支持
    - 从 DisplayRenderAgent 中删除 handleVoiceInput 方法
  - 改动文件：
    - aasc/components/message-dispatcher.js - 修改 voiceInput 路由
    - aasc/actors/voice-command-actor.js - 添加 handleVoiceInput 方法
    - aasc/agents/index.js - VoiceCommandAgent 添加 processVoiceInput，DisplayRenderAgent 删除 handleVoiceInput
    - aasc/actor-adapter.js - ActorFactory 配置修正

- ✅ 子显示端语音播放无排队机制
  - 问题：子显示端（Node.js/Go）收到多个TTS消息时，音频并行播放而非排队依次播放，导致语音混乱
  - 修复：在 AudioPlayer 中添加播放队列（playQueue + processQueue），新音频加入队列后依次播放
  - 实现：
    - Node.js：audio-player.js 添加 queueURL/queueBuffer/processQueue/clearQueue 方法，main.js 的 playAudioFromURL 改为调用 queueURL
    - Go：audio.go 添加 QueueURL/QueueData/processQueue/ClearQueue 方法，main.go 的 playAudioFromURL 改为调用 QueueURL
    - TTS stop 动作同时清空队列（clearQueue/ClearQueue）
    - stopRequested 标志确保停止时跳过队列中剩余音频
  - 改动文件：
    - voice-display-node/audio-player.js - 添加播放队列机制
    - voice-display-node/main.js - playAudioFromURL 改用队列，stop 清空队列
    - voice-display/audio.go - 添加播放队列机制
    - voice-display/main.go - playAudioFromURL 改用队列，stop 清空队列
    - docs/spec/voice-display.md - 更新 AudioPlayer 伪代码

### 新功能
- ✅ 显示端UI四角布局 + 旋转重力方向调整
  - 需求：旋转后UI元素保持在以0度为基准的画面四角，根据新重力方向调整文字垂直方向
  - 实现：
    - UI四角布局：连接状态（左上）、时间（右上）、文件名（左下）、音频可视化/语音（右下）
    - 旋转后位置映射：UI元素保持在0度基准的物理位置
    - 90度：使用 writingMode: vertical-rl 实现竖向文字，字符顶部朝左（=物理上方）
    - 270度：使用 writingMode: vertical-rl + rotate(180deg) 实现竖向文字，字符顶部朝右（=物理上方）
    - 180度：使用 transform: rotate(180deg) 翻转文字
    - connectionStatus 和 monitor-wrapper 纳入旋转管理（之前不参与旋转）
    - CSS 移除 connectionStatus 和 monitor-wrapper 的固定定位，由 JS 统一管理
    - 响应式媒体查询移除固定定位属性，避免与旋转逻辑冲突
  - 改动文件：
    - public/display.html - 重写 applyRotation 函数，添加 monitorWrapper 元素引用和 id
    - public/css/display.css - 移除 connectionStatus/monitor-wrapper 固定定位，添加 transition
    - docs/spec/display-ui-rotation.md（新增）- 旋转功能实现文档

### Bug 修复
- ✅ 设备连线指令重复触发TTS
  - 问题：显示端频繁重连时，executeDeviceEvent 被多次调用，导致同一连线指令（如"早上好"）重复执行，生成多次相同的TTS
  - 修复：在 executeDeviceEvent 中添加30秒防抖机制，同一IP同一事件在30秒内不重复执行
  - 改动文件：
    - server.js - 添加 deviceEventDebounce Map 和防抖检查逻辑

- ✅ 添加树状结构的设备列表
  - 需求：在控制端添加树状结构的设备列表，支持展开/收起、设备设置编辑、连线/掉线自定义指令
  - 实现：
    - 后端：core/config.js 添加 deviceEvents 配置管理（getDeviceEvents/getDeviceEvent/setDeviceEvent/removeDeviceEvent）
    - 后端：server.js 添加设备事件 API（GET/PUT/DELETE /api/device-events/:ip）和设备设置 API（GET/PUT /api/device-settings/:displayId）
    - 后端：server.js 添加 executeDeviceEvent 函数，在显示端连线/掉线时自动执行自定义指令
    - 前端：新增 device-tree.js 树状设备列表组件，支持展开/收起节点
    - 前端：树节点包含画面设置（旋转/填充/音量/画布）、事件指令（连线/掉线指令配置）、浏览器信息
    - 前端：选择模式栏（单选/全选/自适应）集成到树状列表顶部
    - 前端：WebSocket 添加 deviceEventExecuted 消息处理，显示指令执行通知
    - HTML：upload.html 中显示端选择区域替换为设备树容器
    - CSS：upload.css 添加完整的树状列表样式
  - 改动文件：
    - core/config.js - 添加 deviceEvents 配置管理方法
    - server.js - 添加设备事件/设置 API 端点和 executeDeviceEvent 函数
    - public/js/device-tree.js（新增）- 树状设备列表前端组件
    - public/js/websocket.js - 添加 DeviceTree 同步和 deviceEventExecuted 消息处理
    - public/js/main.js - 初始化 DeviceTree
    - public/upload.html - 替换显示端列表为设备树容器
    - public/css/upload.css - 添加树状列表样式

### Bug 修复
- ✅ 控制端画面裁剪区域刷新页面后裁剪框没有和显示端实际角度一样
  - 问题：`Crop.setRotation()` 只设置了 `this.rotation` 值和按钮状态，但没有给预览图片添加 CSS 旋转类（如 `rotate-90`），导致刷新页面后裁剪框角度与显示端不一致
  - 修复：在 `setRotation()` 中添加与 `applyRotation()` 相同的 CSS 旋转类应用逻辑，但不发送控制指令到显示端
- ✅ 控制端画面裁剪区域刷新页面后裁剪框位置和大小与显示端不一致
  - 问题：`displayState` 恢复时，`setRotation` 添加 CSS 旋转类后有 300ms transition 动画，但 `updateBox` 立即调用，导致 `getBoundingClientRect()` 获取的是动画中间状态的位置；另外 `setData` 和 `setRotation` 在 `showPreview` 之前调用，图片未加载时设置无效
  - 修复：调整 `displayState` 恢复顺序，先设置 `canvasSize` 和 `fit` 模式，再在 `showPreview` 回调中 `setData` + `setRotation`，最后延迟 350ms 后 `updateBox`；非媒体切换时也先 `setData` + `setRotation` 再延迟 `updateBox`
  - 改动文件：
    - public/js/websocket.js - 重构 displayState 恢复逻辑
- ✅ 设备事件指令处理逻辑重构，事件指令和 #chatInput 使用相同处理逻辑
  - 问题：设备事件指令（连线/掉线）的聊天处理和 #chatInput 不一致，缺少 chat.addMessage 记录、多显示端支持、playOnControl 等功能
  - 修复：
    - 提取 `handleChatMessage(options)` 共享函数，包含完整的聊天处理逻辑（addMessage、chatStream、多显示端、playOnControl 等）
    - `chatMessage`、`voiceCommand`、`executeDeviceEvent` 的聊天部分都通过 `handleChatMessage` 处理
    - `processVoiceCommand` 不再自己处理 chatStream，只返回结果让 server.js 用 `handleChatMessage` 处理
    - 删除 `voiceCommand.js` 中的 `handleChatStream` 函数
  - 改动文件：
    - server.js - 新增 handleChatMessage 共享函数，简化 chatMessage/voiceCommand/executeDeviceEvent 处理
    - core/voiceCommand.js - 删除 handleChatStream，processVoiceCommand 不再接收 sendToControl 参数
- ✅ 子显示端不识别 reminder 消息类型
  - 问题：`reminder.js` 通过 `sendToDisplay` 发送 `type: 'reminder'` 消息，但子显示端（Node.js/Go）不认识该消息类型，报"未知消息类型: reminder"
  - 修复：在子显示端添加 `handleReminder` 方法，处理 `voice` 动作（播放TTS音频）和 `popup` 动作（日志记录）
  - 改动文件：
    - voice-display-node/main.js - 添加 reminder 消息处理和 handleReminder 方法
    - voice-display/main.go - 添加 reminder 消息处理和 handleReminder 方法
- ✅ 事件指令被处理两次
  - 问题：`executeCommands` 有独立的匹配逻辑（`action.includes('报时')`等），和 `processVoiceCommand` 的逻辑不一致，导致：
    - "报时" 和 "开启报时" 都匹配 `includes('报时')`，`handleTimeAnnounceCommand` 被调用两次
    - "今天提醒" 不匹配 `=== '今日提醒'`，落到 `includes('提醒')` 走了 `handleReminderCommand`（创建提醒）而非 `handleTodayReminders`（播报今日提醒）
    - "静音"/"取消静音" 等指令没有对应处理，走了 `onChat` → `handleChatMessage` 而非 `handleMuteCommand`/`handleUnmuteCommand`
  - 修复：
    - `executeCommands` 改为对每个 action 调用 `processVoiceCommand`，复用同一套匹配逻辑，消除重复处理
    - 添加递归深度限制（3层），防止自定义指令循环引用
    - `onChat` 回调新增 `systemPrompt` 参数，支持自定义系统提示词
    - 新增 `onShowHelp`、`onModeChange`、`onSystemMessage` 回调
    - 修复 `server.js` 中 `executeCommands` 消息处理使用了不存在的 `window.WebSocketManager`
    - 客户端 `chat.js` 的 `executeCommands` 改为发送 `executeCommands` 消息到服务端，不再本地匹配
  - 改动文件：
    - core/voiceCommand.js - executeCommands 改为调用 processVoiceCommand
    - server.js - 更新所有 executeCommands 调用的回调参数，修复 executeCommands 消息处理
    - public/js/chat.js - executeCommands 改为发送消息到服务端
- ✅ 子显示端不识别 voiceCommand 消息类型 & 设备离线指令语音发送给已断开显示端
  - 问题1：`voiceCommand.js` 通过 `sendToDisplay` 发送 `type: 'voiceCommand'` 消息（confirm/response/searchResult/weatherResult/playChoices），子显示端不认识该消息类型
  - 问题2：设备离线事件 `onDisconnect` 触发时，`displayClients.delete(displayId)` 已执行，`executeDeviceEvent` 传入的 `displayId` 对应的显示端已断开，TTS 无法送达
  - 修复：
    - 子显示端（Node.js/Go）添加 `voiceCommand` 消息处理，播放 TTS 音频
    - `executeDeviceEvent` 在 `onDisconnect` 事件时，检测原显示端是否在线，若已断开则找其他在线显示端播报语音
    - 若无在线显示端则跳过语音播报，仅通知控制端
  - 改动文件：
    - voice-display-node/main.js - 添加 voiceCommand 消息处理和 handleVoiceCommand 方法
    - voice-display/main.go - 添加 voiceCommand 消息处理和 handleVoiceCommand 方法
    - server.js - executeDeviceEvent 离线事件时找其他在线显示端
- ✅ 早上好组合指令天气TTS未正常播放 & 指令回复不应发给聊天助手
  - 问题1：`executeCommands` 调用 `processVoiceCommand(action, displayId, null)` 时传入 `callbacks=null`，导致 `handleWeatherCommand` 等函数走 `sendToDisplay` 分支直接发送 `voiceCommand` 消息，子显示端不识别该消息类型
  - 问题2：之前修复时将 `onResult` 映射到 `onChat` → `handleChatMessage`，导致指令回复（天气、报时等）被发给聊天助手处理，而非直接 TTS 播放
  - 修复：
    - 子显示端添加 `voiceCommand` 消息处理（Node.js/Go），支持直接播放 TTS
    - `executeCommands` 传 `callbacks=null` 给 `processVoiceCommand`，让指令处理函数直接通过 `sendToDisplay` 发送 TTS，不经过聊天助手
    - 只有 `processVoiceCommand` 返回 `{ type: 'chat' }` 的非指令文本才走 `onChat` → 聊天助手
  - 改动文件：
    - core/voiceCommand.js - executeCommands 传 null callbacks，指令回复不经过聊天助手
- ✅ 显示端文字旋转方向修复
  - 问题：180度时文字没有自身翻转，90度时布局和文字方向不正确
  - 修复：
    - 180度：所有UI元素添加 `transform: rotate(180deg)`，文字自身上下翻转
    - 90度：参考270度布局位置，文字使用 `writingMode: vertical-lr` + `transform: rotate(180deg)` 上下翻转
    - 270度：补充 `writingMode: vertical-rl` 设置
  - 改动文件：
    - public/display.html - applyRotation() 修改90度和180度的文字旋转逻辑
- ✅ 服务端被Linux OOM Killer杀掉问题优化
  - 问题：服务端运行一段时间后被Linux系统杀掉，疑似内存泄漏
  - 修复：
    - `pendingConfirmations` 中 play 类型确认添加自动过期清理（setTimeout 35秒）
    - 添加定期清理过期确认项的机制（每60秒检查）
    - `chatHistory` 保存改为防抖模式（2秒延迟），避免每次 addMessage 都写文件
    - 添加内存监控日志（每10分钟打印 RSS/Heap/External）
  - 改动文件：
    - core/voiceCommand.js - play 确认过期清理 + 定期清理过期确认项
    - core/chat.js - saveHistory 改为防抖模式
    - server.js - 添加内存监控日志
  - 改动文件：
    - public/js/crop.js - setRotation() 添加 CSS 旋转类应用

- ✅ 设备事件指令没有发送给聊天模块统一处理
  - 问题：`executeDeviceEvent()` 调用 `voiceCommand.processVoiceCommand(command, null, null)` 时传入 `displayId=null` 和 `callbacks=null`，导致返回聊天类型结果时无法通过聊天模块处理，TTS 也无法发送到显示端
  - 修复：
    - `executeDeviceEvent()` 新增 `displayId` 参数，传入显示端ID
    - 处理 `processVoiceCommand` 返回结果：`showHelp` 类型广播给控制端，`commands` 和 `chat` 类型通过 `chat.chatStream` 统一处理
    - 聊天结果通过 `broadcastToControls` 发送给控制端，TTS 通过 `sendToDisplay` 发送给显示端
    - 调用处传入 `displayId` 参数
  - 改动文件：
    - server.js - executeDeviceEvent 添加 displayId 参数和聊天模块处理逻辑

- ✅ 显示端语音状态UI大小不正确
  - 问题：`#voiceStatus` 的 font-size 为 14px、padding 为 6px 12px，与显示端其他UI元素（时间48px、文件名24px）不协调，整体偏小
  - 修复：
    - `#voiceStatus` font-size 从 14px 调整为 24px，padding 从 6px 12px 调整为 10px 20px，border-radius 从 4px 调整为 12px
    - `#voiceTextDisplay` font-size 从 18px 调整为 24px，padding 从 10px 16px 调整为 12px 20px，border-radius 从 8px 调整为 12px，bottom 从 60px 调整为 80px
    - `voice-pulse` 动画优化：添加 box-shadow 发光效果，缩放从 1.2 调整为 1.1，动画周期从 1s 调整为 1.5s
    - 添加 text-shadow 增强文字可读性
    - 响应式媒体查询 `@media (max-width: 768px)` 中添加 `#voiceStatus` 和 `#voiceTextDisplay` 适配
    - 旋转逻辑中 voiceTextDisplay 偏移从 60px 调整为 80px
  - 改动文件：
    - public/css/display.css - 语音状态和语音文字显示样式调整
    - public/display.html - 旋转逻辑中 voiceTextDisplay 位置偏移调整

- ✅ 控制端画面裁剪区域刷新页面后不显示媒体和裁剪框
  - 问题：AASC 系统中 `MediaControlAgent.getState()` 方法错误地使用 `context.sendToDisplay()` 将 `displayState` 发送给显示端，而非发送给请求该状态的控制端
  - 原因：控制端刷新页面后发送 `getState` 请求，但响应被发到了显示端，控制端永远收不到 `displayState`，导致 `Crop.showPreview()` 不被调用
  - 修复：将 `context.sendToDisplay()` 改为 `context.ws.send()`，直接将 `displayState` 发回给控制端 WebSocket 连接
  - 改动文件：
    - aasc/agents/index.js - MediaControlAgent.getState() 修改发送目标

### 新功能
- ✅ 子显示端（语音端）完整支持
  - 需求：控制端/显示端列表要包含子显示端，地图里也要显示，语音播放也需要发送到子显示端
  - 实现：
    - voice-display-node 改为通过 /display 路径连接服务器，URL 参数 subDisplay=true 标识为子显示端
    - 服务端识别子显示端连接，在 displayClients 中标记 isSubDisplay
    - getDisplayList 返回 isSubDisplay 字段
    - 控制端显示端列表添加子显示端标识（🎤图标 + "子显示端"标签 + 橙色左边框）
    - 地图添加 SUB_DISPLAY 建筑类型（橙色，🎤图标）
    - 地图面板实现 handleDisplayListUpdate，实时更新地图上的显示端
    - 地图面板优先使用控制端 WebSocket 连接
    - TTS/语音播报支持多显示端发送（displayIds 数组），全选/自适应模式时发送到所有选中的显示端
    - chatMessage 也支持多显示端发送
  - 改动文件：
    - voice-display-node/main.js - 改用 /display 路径连接，移除 register 消息，添加更多消息类型处理
    - server.js - 解析 URL 参数识别子显示端，getDisplayList 添加 isSubDisplay，TTS/chat 支持 displayIds
    - aasc/middleware/index.js - DisplayCheckMiddleware 从 typesRequiringDisplay 中移除 chat/chatMessage
    - aasc/components/state-manager.js - getDisplayList 添加 isSubDisplay
    - public/js/display-list.js - 子显示端视觉区分
    - public/css/upload.css - 子显示端样式
    - public/js/map/core/constants.js - 添加 SUB_DISPLAY 类型、颜色、尺寸、图标
    - public/js/map/core/data-adapter.js - 支持子显示端建筑类型和布局
    - public/js/map/map-panel.js - 实现 handleDisplayListUpdate，优先使用控制端 WebSocket
    - public/js/websocket.js - sendTts 支持多显示端
    - public/js/chat.js - chatMessage 和 TTS 支持多显示端

### Bug 修复
- ✅ 修复 AASC Middleware rejected 错误
  - 原因：DisplayCheckMiddleware 将 chat/chatMessage 类型列入需要显示端验证的类型，但 chat 消息不一定需要 displayId
  - 解决：从 typesRequiringDisplay 中移除 chat/chatMessage，当显示端不存在时改为警告并放行
  - 改动文件：
    - aasc/middleware/index.js - DisplayCheckMiddleware 修改验证逻辑

- ✅ 修复控制端裁剪框刷新页面后不显示
  - 原因：showPreview 中 recalculateSize 会覆盖 setData 设置的裁剪数据；displayState 处理中 updateBox 在媒体加载前调用
  - 解决：showPreview 添加 onReady 回调参数，displayState 处理时保存裁剪数据，在媒体加载完成后通过回调恢复裁剪数据并更新裁剪框
  - 改动文件：
    - public/js/crop.js - showPreview 添加 onReady 回调，_retryShowPreview 支持回调
    - public/js/websocket.js - displayState 处理时使用回调恢复裁剪数据

- ✅ 修复 voice-display-node TTS 播放音频失败（self-signed certificate）
  - 原因：node-fetch 默认验证 SSL 证书，自签名证书被拒绝
  - 解决：audio-player.js 和 asr-client.js 添加自定义 https.Agent，设置 rejectUnauthorized: false
  - 改动文件：
    - voice-display-node/audio-player.js - 添加 httpsAgent，playFromURL 使用自定义 agent
    - voice-display-node/asr-client.js - 添加 httpsAgent，_getFetchOptions 方法统一处理

- ✅ 修复显示端没有[Crop]打印日志
  - 原因：display.html 的 applyCrop 函数没有日志输出
  - 解决：在 applyCrop 函数中添加详细日志，包括容器尺寸、媒体尺寸、旋转角度、适配模式、裁剪百分比、最终样式等
  - 改动文件：
    - public/display.html - applyCrop 添加详细日志输出

- ✅ 修复整点报时设置状态显示问题
  - 原因：renderTimeAnnounceConfig 函数缺少日志，难以排查配置加载和渲染问题
  - 解决：在 loadTimeAnnounceConfig 和 renderTimeAnnounceConfig 函数中添加详细日志
  - 改动文件：
    - public/js/tts.js - 添加配置加载和渲染日志

- ✅ 修复UI旋转后超出画面边界
  - 原因：applyRotation 函数没有边界检查，旋转后的UI元素可能超出画面
  - 解决：添加边界检查逻辑，使用 requestAnimationFrame 在旋转后检查元素位置，超出边界时自动调整
  - 改动文件：
    - public/display.html - applyRotation 添加边界检查

- ✅ 更新 voice-display-node 安装文档
  - 原因：speaker 原生模块需要 Python 和 Visual Studio Build Tools 编译
  - 解决：添加详细的 Windows 安装步骤和常见问题解答
  - 改动文件：
    - docs/spec/voice-display.md - 添加 Python、VS Build Tools 安装说明

- ✅ 移除 speaker 依赖，改用系统命令播放音频
  - 原因：speaker 原生模块需要 Python 和编译工具，安装复杂
  - 解决：使用系统命令播放音频（Windows: PowerShell, macOS: afplay, Linux: aplay），无需编译原生模块
  - 改动文件：
    - voice-display-node/audio-player.js - 重写为使用系统命令
    - voice-display-node/package.json - 移除 speaker 和 wav 依赖

- ✅ 修复控制端裁剪框自动显示问题
  - 原因：收到显示端状态更新时自动调用 showPreview 显示裁剪框
  - 解决：只有当媒体 URL 变化时才调用 showPreview，刷新页面后能正确恢复裁剪框预览
  - 改动文件：
    - public/js/websocket.js - 添加媒体 URL 变化检查

- ✅ 修复子显示端连接服务器使用内网IP
  - 原因：config.json 中配置的是 localhost:3000，其他设备无法连接
  - 解决：服务器启动时自动将内网 IP 写入 voice-display-node/config.json
  - 改动文件：
    - server.js - 添加 updateVoiceDisplayConfig 函数

- ✅ 修复控制端裁剪框刷新页面后不显示的问题
  - 原因：页面刷新后 currentDisplayId 为 null，displayState 消息被跳过
  - 解决：收到 displayState 时自动选择显示端
  - 改动文件：
    - public/js/websocket.js - 添加自动选择显示端逻辑

- ✅ UI旋转90度和270度时宽高切换显示
  - 需求：旋转时UI元素保持在视觉上的正确位置
  - 实现：根据旋转角度重新定位UI元素
  - 改动文件：
    - public/display.html - 重写 applyRotation 函数

- ✅ 今天提醒和明天提醒指令排除每天重复的提示
  - 原因：daily 类型的提醒被包含在今日/明日提醒中
  - 解决：过滤时排除 daily 类型
  - 改动文件：
    - core/voiceCommand.js - 修改过滤逻辑

- ✅ 子显示端支持使用自签wss
  - 原因：WebSocket 默认验证证书，自签名证书会被拒绝
  - 解决：wss 连接时设置 rejectUnauthorized: false
  - 改动文件：
    - voice-display-node/main.js - 添加 wsOptions 配置

- ✅ 修复控制端裁剪框刷新页面后不显示的问题
  - 原因：页面刷新后没有发送 getState 消息获取显示端状态
  - 解决：收到 displayList 时自动选择显示端并发送 getState
  - 改动文件：
    - public/js/websocket.js - 添加自动发送 getState 逻辑

- ✅ UI旋转90度时时间竖向显示在右上角
  - 需求：90度时时间从上到下竖向显示在右上角
  - 实现：使用 writingMode: vertical-rl 实现竖向文字
  - 改动文件：
    - public/display.html - 修改 applyRotation 函数

- ✅ 修复聊天发送消息没反应的问题
  - 原因：WebSocket 连接未建立时发送消息没有任何提示
  - 解决：添加错误处理和重连逻辑
  - 改动文件：
    - public/js/chat.js - 添加 WebSocket 连接检查和重连

- ✅ 修复控制端裁剪框刷新页面后不显示的问题
  - 原因：页面刷新后需要主动发送 getState 获取显示端状态
  - 解决：收到 displayList 时自动发送 getState
  - 改动文件：
    - public/js/websocket.js - 添加自动发送 getState 逻辑和详细日志

- ✅ 修复 viewer3d.html fetchAndDisplayActors TypeError: Failed to fetch
  - 原因：fetchAndDisplayActors 缺少错误处理，服务器不可达时每5秒打印错误
  - 解决：添加页面可见性检查（document.hidden）、HTTP状态码检查、错误计数和日志降频（前3次+每10次打印）、指数退避重试间隔（5s→60s）
  - 改动文件：
    - public/viewer3d.html - fetchAndDisplayActors 添加错误处理，startActorUpdates 改用 setTimeout 递归调度+退避，添加 stopActorUpdates

- ✅ 修复控制端发送聊天没有正常显示
  - 原因：handleResponse 中流式DOM元素被意外移除时，消息不会显示
  - 解决：先更新 history 数据，再处理流式元素；如果流式元素不存在，回退到 renderHistory 重新渲染
  - 改动文件：
    - public/js/chat.js - handleResponse 调整逻辑顺序，添加 renderHistory 回退

- ✅ 修复显示端一直发送无效语音输入
  - 原因：语音识别返回"ignored"后立即重新监听，形成无限循环
  - 解决：添加连续忽略计数器（consecutiveIgnoreCount），超过3次后进入冷却期（10s×2^n），冷却期内不启动录音；成功识别后重置计数器
  - 改动文件：
    - public/display.html - 添加 consecutiveIgnoreCount/voiceCooldownUntil 变量，sendAudioForRecognition 添加冷却逻辑，startVoiceRecording 添加冷却检查

- ✅ 修复控制端非裁剪适配模式自动发送crop数据
  - 原因：sendFitMode 总是同时发送 fit 和 crop 两条消息，导致非裁剪模式也被切换
  - 解决：只在 fit === 'crop' 时发送 crop 数据
  - 改动文件：
    - public/js/controls.js - sendFitMode 添加条件判断

- ✅ 修复控制端裁剪框不显示
  - 原因：媒体元素尺寸为0时 updateBox 不处理，showPreview 在媒体未加载时不重试
  - 解决：updateBox 添加空值检查和零尺寸处理，showPreview 添加 _retryShowPreview 重试机制（最多5次，递增延迟）
  - 改动文件：
    - public/js/crop.js - updateBox 添加防御性检查，showPreview 添加重试逻辑

- ✅ 修复裁剪框在媒体加载后被隐藏的问题
  - 原因：updateBox 在媒体尺寸为0时设置 `display: none`，导致裁剪框被隐藏
  - 解决：移除 updateBox 中的 `this.box.style.display = 'none'`，当媒体尺寸为0时只返回不更新位置，但不隐藏裁剪框
  - 改动文件：
    - public/js/crop.js - updateBox 移除隐藏裁剪框的逻辑

- ✅ 修复裁剪框媒体尺寸为0的根本原因
  - 原因：图片/视频加载后立即调用 recalculateSize，但浏览器还未完成布局计算，getBoundingClientRect 返回 0
  - 解决：使用 requestAnimationFrame 确保在下一帧渲染后再计算尺寸
  - 改动文件：
    - public/js/crop.js - showPreview 中所有 recalculateSize 调用改用 requestAnimationFrame 包装

- ✅ 修复 tts-agent Cannot read properties of undefined (reading 'length') 错误
  - 原因：splitIntoSentences 函数未检查 text 参数是否为空，当 text 为 undefined 时报错
  - 解决：在 splitIntoSentences 函数开头添加空值检查，如果 text 为空或非字符串则返回空数组
  - 改动文件：
    - core/chat.js - splitIntoSentences 添加空值检查

- ✅ voice-display-node 录音器改用 PvRecorder 替代 naudiodon
  - 原因：naudiodon 安装时需要 Python 和编译工具链
  - 解决：使用 @picovoice/pvrecorder-node 替代，预编译无需 Python
  - 实现：
    - 新增 audio-recorder-pv.js 使用 PvRecorder API
    - main.js 自动检测并优先使用 PvRecorder，失败则回退到 naudiodon
    - package.json 将录音库移到 optionalDependencies
  - 改动文件：
    - voice-display-node/audio-recorder-pv.js（新增）
    - voice-display-node/main.js - 添加录音器自动检测逻辑
    - voice-display-node/package.json - 调整依赖配置

- ✅ 添加裁剪框调试日志
  - 目的：排查媒体尺寸为0的根本原因
  - 在 showPreview、recalculateSize、updateBox 中添加详细日志
  - 在 websocket.js 中添加 displayState 消息处理日志
  - 在 crop.js init 中添加元素存在性检查
  - 在 display.html 中添加 TTS 播放日志
  - 改动文件：
    - public/js/crop.js - 添加 console.log 调试输出
    - public/js/websocket.js - 添加 displayState 调试日志
    - public/display.html - 添加 TTS 播放调试日志

- ✅ 修复测试整点报时没有声音的问题
  - 原因：checkAndAnnounce 没有检查是否有显示端连接，且缺少日志
  - 解决：添加显示端连接检查，如果没有连接的显示端则输出警告并返回 false；添加详细日志
  - 原因2：AASC actor-adapter 没有正确路由 testTimeAnnounce action
  - 解决：修改 handleMessage 添加特殊操作优先处理逻辑（testTimeAnnounce, stop, getState, getReminders）
  - 改动文件：
    - core/timeAnnounce.js - checkAndAnnounce 添加连接检查和日志
    - aasc/actor-adapter.js - handleMessage 添加特殊操作路由逻辑

- ✅ 修复90度/270度旋转时UI上下反转的问题
  - 原因：反向旋转后文字上下颠倒
  - 解决：90度/270度时，在反向旋转后额外添加 scaleY(-1) 翻转，使文字保持正向
  - 原因2：UI元素绕自身中心旋转，而不是画面中心
  - 解决：计算 UI 元素相对于画面中心的偏移，设置正确的 transform-origin
  - 改动文件：
    - public/display.html - applyRotation 添加 scaleY(-1) 处理和 transform-origin 计算

- ✅ 修复测试整点报时功能不生效
  - 原因：sendTts 方法要求 currentDisplayId 存在，但整点报时测试不需要指定显示端
  - 解决：testTimeAnnounce 直接发送 WebSocket 消息，绕过 sendTts 的显示端检查
  - 改动文件：
    - public/js/tts.js - testTimeAnnounce 改为直接发送 WebSocket 消息

### 新功能
- ✅ 显示端UI旋转补偿
  - 功能：当显示端旋转90°/270°时，时间、文件名等UI元素自动反向旋转，保持文字始终正向可读
  - 实现：applyRotation 中对UI元素添加反向旋转 transform，90°/270°时限制 maxWidth 为 50vh
  - 改动文件：
    - public/display.html - applyRotation 添加UI元素旋转补偿

- ✅ 添加显示端本地语音识别（sherpa-onnx-wasm）
  - 功能：显示端可使用浏览器本地 WASM 进行语音识别，无需发送音频到服务器
  - 实现：
    - 创建 sherpa-asr.js 模块，懒加载 WASM 模型
    - 支持流式识别（startStreaming/stopStreaming）
    - 自动回退到服务器端 ASR
    - 添加 /api/config/localAsr 配置端点
  - 改动文件：
    - public/js/sherpa-asr.js（新增）
    - public/display.html - 集成本地 ASR，添加 initLocalAsr 函数
    - server.js - 添加 /api/config/localAsr 端点

- ✅ 添加纯语音输入输出显示端（Go实现）
  - 功能：独立的 Go 程序，作为纯语音交互的显示端客户端
  - 实现：
    - WebSocket 连接到主服务器，注册为显示端
    - 服务器端 ASR 语音识别（通过 HTTP POST /api/asr/recognize）
    - 音频播放（oto）
    - 音频录制（malgo）
    - 自动重连机制
    - VAD 静音检测
    - WAV 编码
  - 改动文件：
    - voice-display/main.go - 主程序，WebSocket 连接和消息处理
    - voice-display/audio.go - 音频播放器
    - voice-display/asr.go - 服务器端 ASR 客户端
    - voice-display/recorder.go - 音频录制器（录音 + VAD + WAV 编码）
    - voice-display/config.json - 配置文件
    - voice-display/go.mod - Go 模块定义

- ✅ 添加纯语音输入输出显示端（Node.js实现）
  - 功能：独立的 Node.js 程序，作为纯语音交互的显示端客户端
  - 实现：
    - WebSocket 连接到主服务器，注册为显示端
    - 服务器端 ASR 语音识别（通过 HTTP POST /api/asr/recognize）
    - 音频播放（Speaker + wav 解码）
    - 音频录制（naudiodon + PortAudio，无需 ffmpeg）
    - 自动重连机制
    - VAD 静音检测
    - WAV 编码
    - 跨平台支持（Windows/Linux/macOS）
  - 改动文件：
    - voice-display-node/main.js - 主程序，WebSocket 连接和消息处理
    - voice-display-node/audio-player.js - 音频播放器（Speaker + wav 解码）
    - voice-display-node/asr-client.js - 服务器端 ASR 客户端
    - voice-display-node/audio-recorder.js - 音频录制器（naudiodon + VAD + WAV 编码）
    - voice-display-node/config.json - 配置文件
    - voice-display-node/package.json - Node.js 模块定义
    - docs/spec/voice-display.md - 添加 Node.js 实现文档

- ✅ 添加子服务器管理功能
  - 功能：支持主服务器将显示端请求分发到多个子服务器，实现负载均衡和分布式部署
  - 实现：
    - SubServer 类：单个子服务器管理（健康检查、显示端注册/注销、消息转发）
    - SubServerManager 类：子服务器集合管理（添加/删除、负载均衡选择、健康检查调度）
    - API 端点：GET/POST/DELETE /api/subservers，GET /api/subservers/health
    - 配置持久化到 config.json
  - 改动文件：
    - core/sub-server.js（新增）- SubServer 和 SubServerManager 类
    - server.js - 集成子服务器管理器，添加 API 端点

### Bug 修复
- ✅ 控制器播放语音时停止监听麦克风
  - 原因：播放 TTS 语音时麦克风仍在监听，会拾取播放的语音导致误触发
  - 解决：playText 发送 TTS 时停止监听；handlePlayOnControl 接收语音播放时停止监听；LLM 响应完成后延迟恢复监听（显示端播放）；本地音频播放完成后恢复监听；添加"播放时暂停监听"UI 开关
  - 改动文件：
    - public/js/chat.js - playText 添加 noInterruptMode 停止监听，handlePlayOnControl 添加停止监听，handleResponse 添加延迟恢复监听，添加 toggleNoInterrupt 方法和 UI

- ✅ 修复控制器裁剪区域不显示的问题
  - 原因：showPreview 中 onload/onloadedmetadata 在 src 之后设置，缓存图片可能丢失事件；displayCanvasSize 为空时 recalculateSize 直接返回不更新裁剪框
  - 解决：先设置事件处理器再设置 src；添加已加载媒体检测；displayCanvasSize 添加默认值回退；裁剪框仅在有效尺寸时显示
  - 改动文件：
    - public/js/crop.js - showPreview 调整事件绑定顺序和已加载检测，recalculateSize/reset/onMouseMove 添加 displayCanvasSize 回退，updateBox 仅在有效尺寸时显示裁剪框，updateContainerSize 防止零宽度

- ✅ 修复 mini monitor 显示与 ttslive 不一致的问题
  - 原因：display.html 的 mini monitor 缺少标签、边框样式、渐变背景，且有多余的绿色边框和"监听中"文字
  - 解决：完全对齐 ttslive 的 mini monitor UI 样式和绘制逻辑
  - 改动文件：
    - public/display.html - 添加 monitor-wrapper 和 monitor-label，drawMonitor/drawIdleMonitor 内部 clearRect，移除动画循环中的边框和文字绘制
    - public/css/display.css - 添加 monitor-wrapper 和 monitor-label 样式，#mini-monitor 添加 border-bottom/border-left/gradient-background

- ✅ 修复 TTS Live 浏览器自动播放限制问题
  - 原因：浏览器自动播放策略要求音频播放必须由用户交互触发
  - 解决：添加音频解锁覆盖层，用户首次点击后解锁音频播放
  - 改动文件：
    - 3rd/ttslive/static/index.html - 添加解锁覆盖层 HTML
    - 3rd/ttslive/static/style.css - 添加解锁覆盖层样式
    - 3rd/ttslive/static/app.js - 添加解锁逻辑和错误处理

- ✅ 修复裁剪信息显示的空值处理错误
  - 原因：当裁剪百分比属性为 null 时，调用 toFixed() 导致 TypeError
  - 解决：在调用 toFixed() 前检查属性是否为 null
  - 改动文件：
    - public/js/websocket.js - updateCropDisplayInfo 添加空值检查
    - public/js/crop.js - updateInputFields 添加空值检查

- ✅ 修复音频可视化被视频遮挡的问题
  - 原因：视频元素应用 transform 属性后创建新的层叠上下文
  - 解决：给 #mediaContainer 添加 z-index: 1，确保在 mini-monitor (z-index: 2000) 下面
  - 改动文件：
    - public/css/display.css - 添加 z-index: 1 到 #mediaContainer

### 新功能
- ✅ 显示端音频频谱可视化
  - 左下角显示 mini-monitor 频谱条形图
  - 录音时显示实时音频频谱和"监听中"标识
  - 空闲时显示波浪动画
  - z-index: 2000 确保在视频上方
  - 改动文件：
    - public/display.html - 添加 canvas 和频谱绘制代码
    - public/css/display.css - 添加 mini-monitor 样式

- ✅ 修复 voiceInput 路由错误
  - voiceInput 消息从 voice-command-actor 改为 display-render-actor
  - 改动文件：
    - aasc/components/message-dispatcher.js - 修正路由配置

- ✅ 本地媒体库 HTTPS 协议支持
  - 媒体库 URL 根据服务器 HTTPS 状态自动选择协议
  - LocalProvider、SmbProvider 支持 isHttps 选项
  - 改动文件：
    - core/media-library.js - 添加 isHttps 参数支持
    - server.js - 传入 isHttps 回调函数

- ✅ 语音识别完整功能（参考 ttslive 设计）
  - 语音输入有效性检查（hasValidContent）
    - 必须包含中文/英文/数字
    - 屏蔽无效输入（如 "um", "uh", "yeah" 等）
    - 屏蔽过短的输入（中文少于2字，英文少于4字符）
  - 无效语音自动忽略并恢复监听
    - 返回 'ignored' 状态
    - 自动恢复监听模式
  - 不打断模式（默认开启）
    - TTS 播放时自动停止录音
    - 播放完成后自动恢复监听
  - 自动监听模式
    - 页面加载后自动启动监听
    - 显示端 WebSocket 连接成功后自动进入监听模式
  - 改动文件：
    - server.js - 添加 hasValidContent 函数和有效性检查
    - public/js/chat.js - 控制端不打断模式和自动监听
    - public/display.html - 显示端不打断模式和自动监听

- ✅ 本地 ASR 语音识别功能（替换 Web Speech API）
  - 使用 sherpa-onnx-node + SenseVoice 模型进行本地语音识别
  - 控制端和显示端都支持本地 ASR
  - 支持 VAD 静音检测（RMS 阈值 0.01，静音时长 1秒）
  - 添加 HTTPS 支持（ssl/key.pem 和 ssl/cert.pem）
  - 新增 API 接口：
    - GET /api/asr/status - 获取 ASR 服务状态
    - POST /api/asr/recognize - 音频识别接口
  - 改动文件：
    - core/asr.js - ASR 模块（新增）
    - server.js - 添加 ASR 初始化和 API 接口
    - public/js/chat.js - 控制端使用本地 ASR
    - public/display.html - 显示端使用本地 ASR

- ✅ ttslive 自动监听功能
  - 页面加载完成后自动进入自动监听模式
  - 通过模拟点击 recordBtn 按钮实现
  - 延迟 500ms 确保页面完全加载
  - 检查浏览器是否支持 mediaDevices.getUserMedia
  - 改动文件：
    - 3rd/ttslive/static/app.js

### 架构重构
- ✅ 重构 server.js 中的 ws.on('message') 函数，按 AASC 架构进行模块化设计
  - AASC (Advance Action System Control) 架构分为四层：
    - **Actor 层**：执行者，组合 Agent 组件，处理消息路由和分发
    - **Agent 层**：能力 Agent，处理具体的业务逻辑（如语音命令、聊天、媒体控制等）
    - **System 层**：构建核心系统，协调 Actor 与 Agent 之间的通信
    - **Component 层**：抽象可复用组件（消息解析器、路由分发器、状态管理器）
  - 新增文件：
    - aasc/components/message-parser.js - 消息解析器组件
    - aasc/components/message-dispatcher.js - 消息路由分发器组件
    - aasc/components/state-manager.js - 状态管理器组件
    - aasc/components/index.js - 组件导出
    - aasc/system/websocket-system.js - WebSocket 系统核心
    - aasc/system/index.js - 系统层导出
    - aasc/agents/base-agent.js - Agent 基类
    - aasc/agents/index.js - Agent 层实现（VoiceCommandAgent, ChatAgent, MediaControlAgent, TTSAgent, ReminderAgent, DisplayRenderAgent, SystemCommandAgent, SearchAgent）
    - aasc/actor-adapter.js - Actor 适配器，将 Agent 包装成 Actor
    - aasc/middleware/index.js - 中间件（验证、日志、错误处理、限流、超时）
    - aasc/init.js - AASC 系统初始化
  - 实现功能：
    - 消息路由机制，根据消息类型自动分发到对应的 Actor 处理
    - 插件化扩展，新功能可通过注册新 Actor 实现
    - 消息验证和错误处理中间件
    - 请求限流和超时处理
    - 保留 fallback 机制，确保向后兼容
  - 改动文件：
    - server.js - 集成 AASC 系统
    - aasc/index.js - 导出新模块

### Bug 修复
- ✅ 修复旋转90度后位置偏移554px的问题
  - 问题：媒体旋转90度后，显示位置出现约554px的偏差
  - 原因：CSS transform rotate 是围绕元素中心旋转的，旋转后元素视觉边界框改变，但代码未补偿这个偏移
  - 计算：偏移量 = (finalWidth - finalHeight) / 2
  - 修复：在 applyCrop 函数中添加旋转补偿逻辑
    - cropX 计算简化为 `displayWidth * (currentCrop.y / 100)`
    - finalTop 改为 `-cropX * scale`
    - 旋转补偿：`finalLeft -= rotationOffset; finalTop += rotationOffset`
  - 改动文件：
    - public/display.html
- ✅ 修复 90°/270° 旋转时裁剪框位置不一致的问题
  - 问题：当媒体旋转 90° 或 270° 时，显示端显示的裁剪位置与控制端裁剪框不一致
  - 原因1：display.html 中 applyCrop 函数的旋转媒体显示尺寸计算逻辑条件分支错误
  - 原因2：旋转后的坐标转换公式错误，视觉坐标与原始坐标的对应关系计算有误
  - 原因3：finalLeft 和 finalTop 的计算未考虑旋转后的方向交换
  - 修复：
    - 修正显示尺寸计算的条件分支
    - 修正坐标转换公式：原始X=100%-视觉Y-视觉高度，原始Y=视觉X
    - 交换 finalLeft 和 finalTop 的计算（旋转后 left 控制视觉上下，top 控制视觉左右）
  - 改动文件：
    - public/display.html

- ✅ 修复 AASC 系统显示端消息处理失败 "Middleware rejected" 的问题
  - 问题：显示端发送 control 类型消息时，AASC 系统返回 "Middleware rejected" 错误
  - 原因：server.js 中显示端连接/断开时，只更新了本地的 displayClients Map，但没有同步到 AASC 系统的 stateManager，导致 DisplayCheckMiddleware 检查显示端不存在而拒绝消息
  - 修复：在 server.js 中添加对 aascSystem.handleDisplayConnect/handleDisplayDisconnect 和 handleControlConnect/handleControlDisconnect 的调用
  - 改动文件：
    - server.js

- ✅ 修复高频消息类型被限流中间件拒绝的问题
  - 问题：commandAck、canvasSize、browserInfo 等高频消息被限流中间件拒绝
  - 原因：这些消息类型未添加到限流豁免列表中
  - 修复：在 init.js 的 rateLimit 配置中添加 exemptTypes，豁免高频状态同步消息
  - 改动文件：
    - aasc/init.js

- ✅ 修复重启服务器后显示端未恢复上次播放状态的问题
  - 问题：服务器重启后，显示端重新连接时没有恢复之前的播放状态
  - 原因：aascSystem.handleDisplayConnect() 创建了新的默认状态，没有合并 savedState
  - 修复：修改 handleDisplayConnect 方法接受 savedState 参数，并在 server.js 中传递该参数
  - 改动文件：
    - aasc/system/websocket-system.js
    - server.js

- ✅ 修复 AASC 系统媒体状态未持久化的问题
  - 问题：选择新媒体后，状态没有被保存，重启服务器后恢复为默认媒体
  - 原因：MediaControlAgent 中缺少 config.updateDisplayState() 调用，媒体状态未持久化到配置文件
  - 修复：在 sendMedia、sendMediaBatch、sendControl 方法中添加 config.updateDisplayState() 调用
  - 改动文件：
    - aasc/agents/index.js

- ✅ 更新 spec 文档以同步代码变更
  - 更新 docs/spec/websocket.md：添加 AASC 系统调用（handleDisplayConnect/handleDisplayDisconnect/handleControlConnect/handleControlDisconnect）
  - 更新 docs/spec/aasc.md：
    - 更新模块结构，添加新文件（init.js, actor-adapter.js, agents/, components/, middleware/, system/）
    - 添加 MediaControlAgent 详细实现描述，包含状态持久化逻辑
    - 添加 handleDisplayConnect 实现描述，包含 savedState 参数
    - 添加 RateLimitMiddleware 配置说明，包含 exemptTypes
  - 改动文件：
    - docs/spec/websocket.md
    - docs/spec/aasc.md

### 新功能
- ✅ 添加裁剪自定义模式
  - 功能：允许手动输入显示宽度、显示高度、左边距、上边距，完全自定义媒体显示参数
  - 实现：
    - 在裁剪控制区域添加自定义模式输入框（宽度、高度、左边距、上边距）
    - 添加"应用自定义"按钮，点击后发送自定义参数到显示端
    - 显示端添加 applyCustomCrop 函数处理自定义模式
    - 自定义模式使用黄色边框样式区分
  - 改动文件：
    - public/upload.html
    - public/css/upload.css
    - public/js/crop.js
    - public/display.html
- ✅ 添加手动设置显示端裁剪参数功能
  - 功能：在显示控制面板添加手动输入裁剪参数的 UI，支持精确设置裁剪区域
  - 实现：
    - 在 upload.html 裁剪控制区域添加 X、Y、宽度、高度四个输入框
    - 输入值范围为 0-100%（百分比）
    - 输入框与裁剪框双向同步：拖拽裁剪框时自动更新输入框，修改输入框时实时更新裁剪框
    - 使用与现有裁剪功能相同的计算公式
    - 添加"应用裁剪"按钮，点击后自动切换到裁剪模式并发送数据到显示端
  - 改动文件：
    - public/upload.html
    - public/css/upload.css
    - public/js/crop.js
- ✅ 在控制端显示显示端回传的裁剪信息
  - 功能：在裁剪控制区域显示显示端回传的详细裁剪信息
  - 实现：
    - 添加"显示端回传信息"面板，显示容器尺寸、媒体尺寸、旋转角度、适配模式、裁剪百分比、最终样式等
    - 去掉 crop.js 中的调试打印语句（console.log）
    - 通过 websocket.js 中的 updateCropDisplayInfo 函数更新 UI
  - 改动文件：
    - public/upload.html
    - public/css/upload.css
    - public/js/websocket.js
    - public/js/crop.js
- ✅ 集成 3D 场景查看器
  - 功能：在上传端添加 3D 展示面板，支持多尺度场景切换
  - 实现：
    - 创建独立的 3D Viewer 页面：public/viewer3d.html
    - 使用 Three.js 实现，通过 CDN 加载，无需构建
    - 支持预设场景：太阳系、地球、城市、执行者
    - 支持大范围尺度变化（从太阳系到房间级别）
    - 支持显示模式切换：正常、线框
    - 支持自动旋转和视角重置
    - 实时显示 FPS、建筑数量、执行者数量、相机距离
  - 建筑数据模型（房间）：
    - 建筑代表物理设备（服务器机房、显示终端、控制中心）
    - 不同类型建筑使用不同颜色：服务器(青色)、显示端(绿色)、控制端(红色)
    - 建筑大小根据类型不同：服务器(4x2.5x4)、显示端(3x2x3)、控制端(2.5x1.8x2.5)
    - 建筑有半透明墙壁和门口
    - 状态灯光显示建筑整体状态
    - 名称标签悬浮在建筑上方
    - 可切换建筑显示/隐藏
  - 执行者可视化：
    - 从 /api/actors 获取执行者数据
    - 执行者显示在所属建筑内部
    - 不同角色使用不同形状：服务器(八面体)、显示端(立方体)、控制端(圆锥)
    - 状态环显示执行者状态（就绪/忙碌/离线）
    - 悬停显示详细信息（名称、状态、角色、能力列表）
    - 点击聚焦到建筑或执行者
    - 自动每 5 秒刷新数据
    - 服务器与显示端/控制端之间的曲线连接
  - 技术细节：
    - 使用 ES Modules 和 Import Map 加载 Three.js
    - 使用 OrbitControls 实现相机控制
    - 使用 Raycaster 实现鼠标交互
    - 使用 TubeGeometry 实现曲线连接
    - 支持阴影、雾效和多光源
  - 改动文件：
    - public/viewer3d.html（新增）
    - public/upload.html
    - public/css/upload.css
    - public/js/main.js
    - server.js（移除 Pascal Editor 相关代码）
- ✅ 地图建筑拖拽和位置持久化
  - 功能：支持拖拽建筑到指定位置，位置自动保存，重启后还原
  - 实现：
    - BuildingSprite 添加拖拽事件处理
    - MapPanel 监听拖拽结束事件并保存位置到服务器
    - 服务端添加 API：GET/PUT /api/map-positions
    - 位置数据存储在 config/map-positions.json
  - 改动文件：
    - public/js/map/sprites/building-sprite.js
    - public/js/map/renderer/renderer-pixi.js
    - public/js/map/renderer/i-renderer.js
    - public/js/map/map-panel.js
    - server.js

### Bug 修复
- ✅ 修复 Sprite 类中 PIXI 对象未定义错误
  - 问题：`create(PIXI)` 方法接收 PIXI 参数，但其他方法无法访问
  - 错误：`PIXI is not defined` 在 `drawBody()` 等方法中
  - 修复：在 `create()` 方法中保存 `this.PIXI = PIXI`，其他方法使用 `this.PIXI`
  - 改动文件：
    - public/js/map/sprites/actor-sprite.js
    - public/js/map/sprites/building-sprite.js
- ✅ 修复 pixi.js 模块解析错误
  - 问题：浏览器无法解析裸模块说明符 `pixi.js`
  - 错误：`Failed to resolve module specifier 'pixi.js'`
  - 修复：在 HTML 中添加 Import Map，映射 `pixi.js` 到 CDN URL
  - 改动文件：public/upload.html
- ✅ 修复地图模块 CommonJS 模块语法在浏览器中不兼容的问题
  - 问题：map 模块使用 CommonJS 语法（require/module.exports），浏览器不支持
  - 错误：`module is not defined` 和 `Identifier 'XXX' has already been declared`
  - 修复：将所有 map 模块文件转换为 ES Modules (ESM) 格式
    - `require('./file')` → `import ... from './file.js'`
    - `module.exports = xxx` → `export default xxx`
    - `module.exports = { xxx }` → `export { xxx }`
  - 修复：HTML 中使用 `<script type="module">` 加载入口文件
  - 改动文件：
    - public/js/map/core/constants.js
    - public/js/map/core/map-data.js
    - public/js/map/core/data-adapter.js
    - public/js/map/renderer/i-renderer.js
    - public/js/map/renderer/renderer-pixi.js
    - public/js/map/sprites/building-sprite.js
    - public/js/map/sprites/actor-sprite.js
    - public/js/map/map-panel.js
    - public/upload.html

### 新增
- ✅ 执行者能力可视化管理系统
  - 新增地图可视化面板，展示系统执行者和能力
  - 使用 PixiJS 实现 2D 渲染，支持未来扩展 3D
  - 架构设计支持 2D/3D 渲染器切换
  - 核心数据模型：
    - BuildingData: 建筑数据模型，代表物理设备
    - ActorData: 执行者数据模型，代表系统执行者
    - ConnectionData: 连接数据模型，代表执行者之间的关系
  - 数据适配器：将 AASC 系统数据转换为可视化数据
  - 渲染器接口：定义统一的渲染器接口，支持多种渲染后端
  - PixiJS 渲染器实现：
    - 分层渲染（连接层、建筑层、执行者层）
    - 支持缩放、平移、拖拽交互
    - 实时更新执行者状态
  - 精灵组件：
    - BuildingSprite: 建筑精灵，显示设备类型和状态
    - ActorSprite: 执行者精灵，显示执行者和能力
  - 地图面板功能：
    - 工具栏：缩放控制、视图重置、图例显示
    - 详情面板：显示选中实体的详细信息
    - 实时数据更新：通过 WebSocket 接收状态变化
  - 服务端 API：
    - GET /api/map-data: 获取完整地图数据
    - GET /api/actors: 获取执行者列表
  - 改动文件：
    - public/js/map/core/constants.js
    - public/js/map/core/map-data.js
    - public/js/map/core/data-adapter.js
    - public/js/map/renderer/i-renderer.js
    - public/js/map/renderer/renderer-pixi.js
    - public/js/map/sprites/building-sprite.js
    - public/js/map/sprites/actor-sprite.js
    - public/js/map/map-panel.js
    - public/css/map.css
    - public/upload.html
    - public/js/main.js
    - server.js
  - 设计文档：docs/design/map-visualization.md
  - 实现文档：docs/spec/map-visualization.md
  - 任务文档：docs/task/2026-04-02_执行者能力可视化管理.md

### Bug 修复
- ✅ 画面裁剪模式添加调试打印语句
  - 控制端添加打印语句：public/js/crop.js
    - sendData: 直接发送视觉裁剪数据，不再转换原始数据
    - updateBox: 打印媒体尺寸、媒体偏移、裁剪框像素位置、裁剪框百分比
    - recalculateSize: 打印显示画布比例、媒体比例、计算后裁剪框
    - 修复旋转时拖动方向不正确的问题（90/180/270度）
    - 修复旋转时调整大小方向不正确的问题（90/180/270度）
  - 显示端通过确认消息发送尺寸信息给控制端：public/display.html
    - applyCrop 返回裁剪信息对象（包含状态、容器尺寸、媒体尺寸等）
    - sendCommandAck 支持 extraData 参数
    - crop 命令发送包含尺寸信息的确认消息
    - 修复 applyCrop 在非裁剪模式下不返回值的问题
    - 修复 90/270 度旋转时裁剪坐标计算错误的问题
  - 控制端接收并打印显示端尺寸信息：public/js/websocket.js
    - 收到 crop 确认消息时打印显示端尺寸信息
  - 服务端转发确认消息：server.js
    - 修复转发 commandAck 时未包含 extraData 字段的问题
  - 改动文件：public/js/crop.js, public/display.html, public/js/websocket.js, server.js

### 新增
- ✅ 显示端全选和自适应功能
  - 新增三种选择模式：单选、全选、自适应
  - 单选模式：选择单个显示端进行媒体下发（默认模式）
  - 全选模式：媒体下发到所有已连接的显示端
  - 自适应模式：根据媒体比例自动匹配显示端方向
    - 横向媒体（宽 > 高）下发到横向显示端
    - 纵向媒体（高 > 宽）下发到纵向显示端
    - 显示端方向判断考虑旋转角度（90°/270° 时方向互换）
  - 显示端列表新增方向指示器（↔ 横向 / ↕ 纵向）
  - 改动文件：public/js/display-list.js, public/js/websocket.js, server.js, public/css/upload.css
  - 设计文档：docs/design/display.md
  - 实现文档：docs/spec/display-selection.md
  - 任务文档：docs/task/2026-03-31_显示端全选和自适应功能.md
- ✅ 时间监听能力实现
  - 创建时间监听模块：core/timeListener.js
    - 支持分钟、小时、天级别的时间变化事件
    - 提供 on/off/once 事件订阅方法
    - 单例模式，全局统一管理
  - 重构报时模块使用时间监听
    - 移除独立定时器，改用时间监听事件
    - 改动文件：core/timeAnnounce.js
  - 重构提醒模块使用时间监听
    - 移除独立定时器，改用时间监听事件
    - 改动文件：core/reminder.js
  - 更新 server.js 启动时间监听
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ 静音/取消静音功能实现
  - 新增静音状态管理：server.js
    - muteState 对象存储静音状态和之前音量
    - muteAllDisplays() 静音所有显示端
    - unmuteAllDisplays() 取消静音恢复音量
  - 新增静音 API 端点
    - GET /api/mute 获取静音状态
    - POST /api/mute 执行静音
    - DELETE /api/mute 取消静音
  - 新增语音命令处理：core/voiceCommand.js
    - handleMuteCommand() 处理静音命令
    - handleUnmuteCommand() 处理取消静音命令
    - 支持指令：静音、全部静音、取消静音、恢复音量
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ~~✅ 音量滑条拖动禁止图标~~ (已移除，影响用户体验)
  - ~~新增 CSS 样式：public/css/upload.css~~
    - ~~拖动时显示 not-allowed 光标~~
  - ~~新增事件监听：public/js/controls.js, public/js/floating-control.js~~
    - ~~mousedown 添加 dragging 类~~
    - ~~mouseup/mouseleave 移除 dragging 类~~
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ 今日/明日提醒功能实现
  - 新增 handleTodayReminders() 函数：core/voiceCommand.js
    - 筛选今日提醒（每日提醒 + 今日一次性提醒）
    - 按时间排序并语音播报
  - 新增 handleTomorrowReminders() 函数：core/voiceCommand.js
    - 筛选明日提醒（每日提醒 + 明日一次性提醒）
    - 按时间排序并语音播报
  - 支持语音指令：今日提醒、今天提醒、明日提醒、明天提醒
  - 设计文档：docs/task/2026-03-31_提醒增强与静音功能.md
- ✅ ViewBind 视图绑定模块实现
  - 创建 core/viewbind 目录
  - 实现 ViewBind 类：core/viewbind/ViewBind.js
    - 数据存储、绑定/解绑管理、变更通知
    - 支持通配符绑定和指定 key 绑定
    - 支持深度比较，避免相同数据触发通知
    - 支持 set/update 方法修改数据
    - 支持在通知过程中延迟解绑
  - 实现 ViewBindList 类：core/viewbind/ViewBindList.js
    - 列表数据管理、列表变化通知
    - 支持 push/pop/remove/insert/clear 操作
    - 支持为每个元素创建 ViewBind
    - 支持 forEach/map/filter/find 方法
  - 扩展 DataSnapshot 类：core/data-snapshot/DataSnapshot.js
    - 添加 bind/unbind/unbindAll 方法
    - 修改 _save 方法触发变更通知
  - 添加单元测试
    - ViewBind 测试：10 个用例
    - ViewBindList 测试：13 个用例
    - DataSnapshot 绑定测试：6 个用例
  - 创建实现文档：docs/spec/viewbind.md
  - 更新文件：docs/spec.md, docs/todo.md
- ✅ ViewBind 视图绑定功能需求分析
  - 创建设计文档：docs/design/viewbind.md
  - 分析 Unity C# 版本 viewbind 实现的核心功能
  - 设计 JavaScript 版本的 ViewBind 类和 ViewBindList 类
  - 设计与 DataSnapshot 模块的集成方案
  - 定义前端使用示例和模块集成方案
  - 创建任务文档：docs/task/2026-03-31_ViewBind实现.md
  - 更新文件：docs/design/viewbind.md, docs/design.md, docs/todo.md
- ✅ DataSnapshot 数据快照模块
  - 创建 core/data-snapshot 目录
  - 实现 DataSnapshot 基类：core/data-snapshot/DataSnapshot.js
    - 使用 Proxy 代理属性访问，实现透明的数据持久化
    - 支持嵌套对象修改自动保存
    - 支持默认值定义（static defaults）
    - 支持批量操作（batch 方法）
    - 自动创建目录结构
    - 深度克隆和深度合并
  - 实现 JsonFile 工具类：core/data-snapshot/JsonFile.js
    - 静态方法：read, write, exists, delete, readOrDefault
  - 创建模块入口：core/data-snapshot/index.js
  - 重构 config.js 使用 DataSnapshot
    - Config 类继承 DataSnapshot 基类
    - 保持原有 API 兼容性
    - 简化代码，移除手动加载/保存逻辑
  - 添加单元测试：core/data-snapshot/DataSnapshot.test.js
    - 11 个测试用例全部通过
    - 覆盖：默认值、自动保存、嵌套对象、删除属性、批量操作、文件加载、深度合并
  - 设计文档：docs/design/data-snapshot.md
  - 实现文档：docs/spec/data-snapshot.md
  - 任务文档：docs/task/2026-03-31_DataSnapshot实现.md
- ✅ 能力组合系统实现
  - 创建能力管道执行器：aasc/pipeline.js
    - PipelineContext: 管道执行上下文，支持数据存储、步骤结果、错误管理
    - PipelineStep: 管道步骤定义，支持输入输出映射、错误策略、重试机制
    - PipelineExecutor: 管道执行器，支持顺序/并行执行、能力调用
    - PipelineBuilder: 管道构建器，支持链式调用
  - 创建能力组合定义：aasc/composition.js
    - Trigger: 触发器定义，支持命令/事件/定时/手动/能力触发
    - CapabilityComposition: 能力组合，包含触发器、管道、降级管道
    - CompositionRegistry: 组合注册表，支持加载/保存/注册/查询
    - CompositionExecutor: 组合执行器，支持按触发执行
    - CompositionBuilder: 组合构建器，支持链式调用
  - 创建能力等级计算器：aasc/level-calculator.js
    - CapabilityScore: 能力分数，包含等级、权重、加权分数
    - ActorLevelScore: 执行者等级分数，包含综合等级、分类分数、建议
    - CapabilityLevelCalculator: 等级计算器，支持执行者/系统等级计算、排名
    - LevelCalculatorBuilder: 计算器构建器
  - 创建能力配置文件：config/capabilities.json
    - 定义 35+ 个能力，按等级分类
    - 包含基础能力（L1-L2）、专业能力（L3-L4）、特殊能力（L3-L5）
    - 支持能力继承和依赖关系
  - 更新入口文件：aasc/index.js
    - 导出所有能力组合系统模块
  - 更新文档：docs/spec/aasc.md
    - 添加管道执行器详细实现
    - 添加能力组合定义详细实现
    - 添加能力等级计算器详细实现
    - 添加使用示例和配置文件说明
  - 更新自测模块：public/js/self-test.js
    - 添加能力组合系统测试用例（8个）
    - 管道模块测试、组合模块测试、等级计算器模块测试
    - 能力配置文件测试、能力等级分布测试、能力分类测试
    - 能力继承测试、入口导出测试
  - 更新自测文档：docs/self-test.md
    - 添加能力组合系统测试项目说明
- ✅ 能力组合系统设计
  - 新增能力组合系统设计文档：docs/design/aasc.md 第12章
  - 定义原子能力（Atomic Capability）结构：输入输出模式、默认执行者、超时、重试策略
  - **核心原则：能力与执行者解耦**
    - 能力是独立定义的功能单元，不绑定到特定执行者
    - 一个能力可以被多个执行者共享使用
    - 执行者通过能力ID引用能力，声明自己拥有哪些能力
  - 定义能力组合（Capability Composition）：触发条件、执行管道、降级管道
  - 设计能力管道（Pipeline）执行流程：顺序执行、并行执行
  - 设计能力等级评估体系：综合等级计算、分类得分、组合得分
  - 设计能力配置系统：JSON配置文件、配置管理器
  - 提供完整示例：报时功能、天气播报、提醒播报
  - 更新文件：docs/design/aasc.md, docs/spec/aasc.md, docs/todo.md
- ✅ 现有系统功能抽象
  - 梳理 core/ 目录下所有核心模块功能
  - 梳理 aasc/actors/ 目录下所有执行者功能
  - 抽象为 25+ 个独立能力，按等级分类：
    - 基础能力（L1-L2）：时间解析、消息处理、事件触发、状态管理、文本显示、显示状态
    - 专业能力（L3-L4）：语音合成、语音播报、提醒管理、媒体搜索、天气获取、网页搜索、AI对话、重要记录
    - 特殊能力（L3-L5）：整点报时、媒体库管理、连接管理、语音命令、系统指令、私聊模式
  - 定义能力组合示例：报时功能、提醒播报、天气播报、播放媒体
  - 创建任务文档：docs/task/2026-03-31_能力组合系统实现.md
  - 更新文件：docs/todo.md
- ✅ AASC 系统架构设计文档
  - 创建完整的设计文档：docs/design/aasc.md
  - 包含消息协议规范、执行者模型、用户模型、能力继承机制
  - 新增执行者能力等级评级（L1-L5）
  - 新增用户模型：用户认证、保密等级（0-5级）、权限控制
  - 新增用户记录功能：系统记录指令、记录存储和查询
  - 新增分布式部署方案和迁移计划
  - 更新文件：docs/design/aasc.md, docs/design.md, docs/todo.md
- ✅ AASC 系统核心实现
  - 第一阶段：消息总线基础
    - 创建消息协议模块：aasc/message.js
    - 创建消息总线核心：aasc/message-bus.js
    - 创建执行者基类：aasc/actor.js
    - 创建消息路由和过滤：aasc/router.js
  - 第二阶段：执行者模型
    - 创建执行者注册表：aasc/registry.js
    - 实现能力等级评级（L1-L5）
    - 实现安全等级（0-5级）
  - 第三阶段：用户模型
    - 创建用户模块：aasc/user.js
    - 实现用户存储、权限管理
    - 创建用户记录模块：aasc/record.js
  - 第四阶段：能力继承
    - 创建能力模块：aasc/capability.js
    - 实现能力继承解析器
    - 定义默认能力集
  - 第五阶段：模块迁移
    - 创建提醒执行者：aasc/actors/reminder-actor.js
    - 创建聊天执行者：aasc/actors/chat-actor.js
    - 创建语音命令执行者：aasc/actors/voice-command-actor.js
    - 创建媒体控制执行者：aasc/actors/media-control-actor.js
    - 创建媒体库管理执行者：aasc/actors/media-library-actor.js
    - 创建画面渲染控制执行者：aasc/actors/display-render-actor.js
    - 创建系统指令执行者：aasc/actors/system-command-actor.js
    - 创建私聊模式执行者：aasc/actors/private-chat-actor.js
    - 创建重要记录执行者：aasc/actors/important-record-actor.js
    - 创建搜索执行者：aasc/actors/search-actor.js
    - 创建语音播报执行者：aasc/actors/tts-actor.js
  - 第六阶段：分布式支持
    - 创建集群模块：aasc/cluster.js
    - 实现集群节点管理
    - 实现跨节点路由
    - 实现边缘计算编排
  - 更新文件：docs/spec/aasc.md, docs/spec.md
- ✅ AASC 系统任务文档
  - 创建任务文档：docs/task/2026-03-30_AASC系统实现.md
  - 包含设计需求、实现规范、自测用例、性能测试、风险评估、预计工时
- ✅ AASC 系统自测用例
  - 新增 AASC 模块加载测试
  - 新增 AASC 消息 API 测试
  - 新增 AASC 执行者注册表测试
  - 新增 AASC 用户存储测试
  - 新增 AASC 能力注册表测试
  - 新增 AASC 集群状态测试
  - 改动文件：public/js/self-test.js, docs/self-test.md
- ✅ 自测功能
  - 控制端新增测试按钮（绿色按钮 🧪）
  - 自动测试显示端连接、WebSocket连接、播放控制、画面控制、语音功能等
  - 测试结果按类别分组显示，支持导出 JSON 报告
  - 改动文件：public/js/self-test.js, public/css/upload.css, public/upload.html
- ✅ 自测文档
  - 包含自测流程、测试项目、注意事项
  - 改动文件：docs/self-test.md

### Bug 修复
- ✅ 修复播放媒体时没有收到 media 类型确认消息的问题
  - 问题：mediaBatch 消息没有 displayId 字段，导致 displayData 为 undefined，代码直接 return
  - 原因：mediaBatch 处理逻辑在 `if (!displayData) return;` 之后
  - 修复：将 mediaBatch 处理逻辑移到 `if (!displayData) return;` 之前
  - 改动文件：server.js
- ✅ 修复播放媒体时显示端确认消息类型错误的问题
  - 问题：点击播放媒体时，控制端会发送裁剪消息，导致显示端确认消息显示为 crop 而不是 media
  - 原因：showPreview 函数调用 recalculateSize 时会自动发送 crop 消息
  - 修复：给 recalculateSize 添加 sendToDisplay 参数，showPreview 时传入 false 不发送数据
  - 改动文件：public/js/crop.js
- ✅ 修复AI助手界面搜索记录撑大界面导致操作区域被遮挡的问题
  - 问题：搜索记录没有高度限制，会撑大整个聊天界面
  - 修复：给 chat-container 添加 max-height: 500px 限制
  - 修复：给 chat-main 添加 overflow-y: auto 和 min-height: 0 使其可滚动
  - 修复：给 chat-search-history 添加 max-height: 150px 和 overflow-y: auto
  - 修复：给 search-history-list 添加 max-height: 100px
  - 改动文件：public/css/chat.css
- ✅ 修复获取天气失败 Request failed with status code 502
  - 问题：wttr.in 天气API服务不稳定，偶尔返回502错误
  - 修复：添加重试机制，最多重试3次，每次间隔1秒
  - 修复：增加请求超时时间从10秒到15秒
  - 修复：优化错误提示信息
  - 改动文件：core/voiceCommand.js
- ✅ 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
  - 问题：旋转90或270度后，拖动方向没有根据旋转角度调整
  - 修复：在 onMouseMove 中根据旋转角度交换 dx 和 dy
  - 修复：90度时 dy 取反，270度时 dx 取反
  - 修复：调整大小时根据旋转角度选择正确的 delta 值
  - 改动文件：public/js/crop.js
- ✅ 新增消息确认机制：控制端发给显示端的消息，显示端进行确认，控制端显示确认结果
  - 需求：控制端发送命令后需要知道显示端是否正确接收并处理
  - 实现：显示端处理命令后发送 commandAck 确认消息
  - 实现：控制端在聊天界面显示确认结果
  - 改动文件：public/display.html, server.js, public/js/websocket.js, public/js/chat.js, public/css/chat.css
- ✅ 新增群聊模式多处理器功能：同一消息可被多个执行者处理
  - 需求：群聊模式下，如"今天天气很好"，可以同时触发天气查询和AI助手回复
  - 实现：添加 checkMultiHandlerKeywords 方法检测多处理器关键词
  - 实现：添加 executeMultiHandlers 方法执行多个处理器
  - 实现：支持天气、提醒、报时、搜索、自定义指令等多处理器
  - 改动文件：public/js/chat.js
- ✅ 修复控制端选择媒体播放，显示端没有响应的问题
  - 问题：sendMedia 函数没有正确等待异步操作完成
  - 修复：将 sendMedia 改为 async 函数，使用 await 等待 sendMediaWithRatio 完成
  - 改动文件：public/js/websocket.js
- ✅ 新增私聊模式不响应系统命令功能
  - 需求：私聊模式下只响应"系统"开头的命令和"退出私聊"命令
  - 实现：在 handleSystemCommand 开头添加私聊模式检查
  - 改动文件：public/js/chat.js
- ✅ 新增自测功能：判断显示端是否接收到控制端指令
  - 需求：自测时需要验证显示端是否正确接收并处理指令
  - 实现：显示端在处理指令后发送 commandAck 确认消息
  - 实现：服务端转发 commandAck 到控制端
  - 实现：自测功能添加 waitForAck 方法等待确认消息
  - 改动文件：public/display.html, server.js, public/js/websocket.js, public/js/self-test.js
- ✅ 修复播放媒体没有发到显示端的问题
  - 问题：handlePlayCommand 和 handlePlaySelection 没有 callbacks 参数支持
  - 修复：添加 callbacks 参数，支持控制端播放语音提示
  - 修复：媒体始终发送到显示端，语音提示根据 playOnControl 决定播放位置
  - 改动文件：core/voiceCommand.js
- ✅ 修复天气结果没有在显示端播报的问题
  - 问题：显示端 handleVoiceCommand 缺少 weatherResult action 的处理
  - 修复：添加 weatherResult 和 playChoices action 的处理
  - 修复：添加 showPlayChoicesPopup 函数显示播放选择弹窗
  - 改动文件：public/display.html, public/css/display.css
- ✅ 修复控制端播放媒体功能不生效的问题
  - 问题：控制端 handleSystemCommand 缺少播放命令的处理
  - 修复：添加 handlePlayCommand 方法，检查显示端选择并发送播放命令
  - 改动文件：public/js/chat.js
- ✅ 修复天气命令不支持控制端播放的问题
  - 问题：天气命令只支持显示端播放，控制端开启"在控制端播放语音"时无法获取天气结果
  - 修复：修改 processVoiceCommand 和 handleWeatherCommand 支持 callbacks 参数
  - 修复：服务端传递 playOnControl 回调函数，支持在控制端播放天气结果
  - 改动文件：core/voiceCommand.js, server.js
- ✅ 修复控制端无法执行静音/取消静音命令的问题
  - 问题：控制端 handleSystemCommand 缺少静音和取消静音的处理
  - 修复：添加 handleMuteCommand 和 handleUnmuteCommand 方法
  - 修复：server.js 添加 mute 和 unmute 消息类型处理
  - 修复：websocket.js 添加 muteResult 和 muteState 消息类型处理
  - 改动文件：public/js/chat.js, server.js, public/js/websocket.js
- ✅ 修复系统指令帮助内容不完整的问题
  - 问题：帮助内容缺少静音、取消静音、今日提醒、明日提醒、天气、播放等指令
  - 修复：更新帮助模态框内容
  - 改动文件：public/upload.html
- ✅ 修复显示端横竖判断未考虑旋转角度的问题
  - 问题：getDisplayList 函数未返回 rotation 属性
  - 修复：在 getDisplayList 中添加 rotation 属性
  - 改动文件：server.js
- ✅ 修复 DataSnapshot Proxy 导致无限递归的问题
  - 问题：Proxy handler 检查 `prop in DataSnapshot.prototype` 只检查基类原型，导致子类方法无法正确访问
  - 当 `config.js` 设置 `module.exports.get = ...` 时，由于 `module.exports = config`（Proxy 对象），实际上修改了 `config.get`，形成循环引用
  - 修复：将 `prop in DataSnapshot.prototype` 改为 `prop in target`，检查整个原型链
  - 改动文件：core/data-snapshot/DataSnapshot.js
- ✅ 修复音量滑条拖动时鼠标变成禁止图标的问题
  - 问题：之前故意添加的禁止图标功能影响用户体验
  - 修复：移除 CSS 中的 `cursor: not-allowed` 样式和 JS 中的 `dragging` 类事件
  - 改动文件：public/css/upload.css, public/js/controls.js, public/js/floating-control.js
- ✅ 修复 floating-control.js 调用错误方法的问题
  - 问题：调用 DisplayList.selectDisplay 方法不存在
  - 修复：改为调用 DisplayList.select 方法
  - 改动文件：public/js/floating-control.js
- ✅ 修复 90度和270度时裁剪框拖动方向错误的问题
  - 问题：旋转后拖动方向与实际方向不一致
  - 修复：在 onMouseMove 中根据旋转角度调整拖动方向
  - 改动文件：public/js/crop.js
- ✅ 修复自定义指令配置文件保存问题
  - 问题：WebSocketManager 缺少通用 send 方法
  - 修复：添加 WebSocketManager.send 方法，创建 chat-commands.json 初始文件
  - 改动文件：public/js/websocket.js, config/chat-commands.json
- ✅ 修复自定义指令无法保存到文件的问题
  - 问题：WebSocket 连接是异步的，loadCommands 在连接完成前被调用，导致数据未加载
  - 修复：添加 WebSocket onopen 回调，连接成功后重新加载 commands 数据
  - 问题2：`if (!displayData) return;` 检查在 setChatCommands 之前，导致没有显示端时无法保存
  - 修复：将 chatHistory、chatSession、chatCommands 相关消息处理移到 displayData 检查之前
  - 改动文件：public/js/websocket.js, public/js/chat.js, server.js
- ✅ 新增服务器状态 API 和时间解析 API
  - GET /api/status：获取服务器运行状态
  - POST /api/time/parse：解析时间表达式
  - 改动文件：server.js

### Bug 修复（历史）
- ✅ 修复 DisplayList.getDisplays 方法未定义导致的 WebSocket 消息解析失败
  - 问题：floating-control.js 调用了不存在的 getDisplays 方法
  - 修复：在 display-list.js 中添加 getDisplays 方法
  - 改动文件：public/js/display-list.js
- ✅ 修复自定义指令没有保存到文件的问题
  - 问题：setCommands 函数使用展开运算符错误合并数据结构
  - 修复：正确处理 commands 数据结构
  - 改动文件：core/chat.js
- ✅ 修复新增本地媒体库后无法访问文件的问题
  - 问题：静态路由只在服务器启动时设置，新增媒体库时未动态添加
  - 修复：在添加媒体库 API 中动态注册静态路由
  - 改动文件：server.js

### 新增（历史）
- 显示端控制页面重构
  - ✅ 浮动控制面板：固定在页面右下角，可在所有页面访问
  - ✅ 快速播放命令：输入文件名直接播放
  - ✅ 显示端选择、播放控制、音量控制、画面填充
  - 改动文件：public/upload.html, public/css/upload.css, public/js/floating-control.js
- 播放命令功能
  - ✅ 指令：`播放{文件名}` 搜索并播放媒体文件
  - ✅ 支持搜索所有媒体库
  - ✅ 多个匹配时列出选项让用户选择
  - 改动文件：core/voiceCommand.js, server.js
- 通用时间解析功能
  - ✅ 支持"今天"、"明天"、"后天"等相对日期
  - ✅ 支持"X秒/分钟/小时/天/周/月/年前/后"等相对时间
  - ✅ 支持"X月X日"、"X年X月X日"等绝对日期
  - ✅ 支持中文数字和阿拉伯数字混合
  - 改动文件：core/timeParser.js, docs/spec/timeParser.md
- 天气语音播报
  - ✅ 天气查询结果自动生成 TTS 语音播报
  - 改动文件：core/voiceCommand.js
- 聊天系统重构
  - ✅ 群聊/私聊模式支持
  - ✅ 系统指令功能（系统帮助、私聊、退出私聊）
  - ✅ 控制端语音播放（TTS 服务生成）
  - ✅ 统一的聊天记录格式和存储
  - ✅ 所有聊天消息进行语音播报
  - ✅ 根据当前选择播报到对应设备（显示端/控制端）
  - ✅ 自定义指令配置和执行
  - ✅ 重要记录功能：`系统记录{内容}`
  - ✅ 搜索功能整合到聊天系统
  - ✅ 语音播报在显示端播报时同时显示文本

### 已实现功能（现有代码）
- 提醒功能：`提醒{时间} {内容}`、重复提醒
- 报时功能：`报时`、`现在几点`、`开启/关闭报时`
- 搜索功能：`搜索{关键词}`
- 取消操作：`拒绝`、`取消`
- 指定助手对话：`{助手名字}{消息}`
- 播放命令：`播放{文件名}`

### 改动文件
- core/timeParser.js: 新增通用时间解析模块
- core/voiceCommand.js: 新增播放命令处理、天气语音播报
- public/upload.html: 新增浮动控制面板
- public/css/upload.css: 新增浮动面板样式
- public/js/floating-control.js: 新增浮动控制面板模块
- public/js/display-list.js: 同步浮动控制面板状态
- public/js/websocket.js: 同步浮动控制面板状态
- public/js/main.js: 初始化浮动控制面板
- server.js: 设置媒体库管理器到语音命令模块
- docs/design/display-control-refactor.md: 新增设计文档
- docs/spec/timeParser.md: 新增时间解析实现文档
- docs/task/2026-03-29_显示端控制页面重构.md: 新增任务文档

### 修复
- ✅ 已完成 [2026-03-29][2026-03-29] 修复自定义系统指令无法正确识别的问题
  - 问题原因：server.js 中 processVoiceCommand 返回 commands 类型时没有处理
  - 改动文件：server.js, docs/spec/voiceCommand.md
- ✅ 已完成 [2026-03-29][2026-03-29] 修复控制端语音输入自定义指令和报时指令无法识别的问题
  - 问题原因：控制端 processVoiceCommand 没有检查自定义指令，timeAnnounce 消息处理在 displayData 检查之后
  - 改动文件：public/js/chat.js, server.js, docs/spec/chat-system.md
- ✅ 已完成 [2026-03-29][2026-03-29] 修复控制端聊天框输入内置指令无法识别的问题
  - 问题原因：handleSystemCommand 只检查自定义指令，没有检查内置指令（报时、提醒、搜索）
  - 改动文件：public/js/chat.js
- ✅ 已完成 [2026-03-29][2026-03-29] 优化指令执行提示，显示执行结果
  - 报时：显示当前时间
  - 搜索：显示正在搜索的内容
  - 提醒：显示设置的提醒内容
  - 今日提醒：显示查询提示
  - 改动文件：public/js/chat.js
- ✅ 已完成 [2026-03-29][2026-03-29] 添加天气查询功能
  - 使用 wttr.in API 查询天气
  - 支持城市名称查询，默认ip地址
  - 改动文件：core/voiceCommand.js, public/js/chat.js

### 2026-03-29 优化系统帮助指令

**已修改功能：**
- 系统帮助指令从"系统帮助"精简为"系统"
- 帮助弹窗从 alert 改为 HTML 模态框实现，体验更好
- 修复语音命令中系统指令无法正确识别的问题

**改动文件：**
- public/js/chat.js: handleSystemCommand 改为调用 showHelp()，新增 showHelp/hideHelp 函数
- public/upload.html: 新增 chatHelpModal 模态框 HTML
- public/js/websocket.js: 新增 showHelp 消息类型处理
- core/voiceCommand.js: 系统指令改为返回 { type: 'showHelp' }
- server.js: 新增 showHelp 消息类型处理
- docs/spec/chat-system.md: 更新伪代码描述

### 2026-03-29 修复群聊助手名字显示问题

**已修复问题：**
- 群聊中发送以 AI 助手名字开头的消息时，自动匹配对应助手模板回复
- 发送给 AI 的消息去掉助手名字前缀，但显示和保存的消息保留完整内容
- 流式消息显示时助手名字正确显示（匹配到的助手名或默认助手名）

**改动文件：**
- public/js/chat.js: sendMessage 区分 displayMessage 和 sendMessage，分别用于显示和发送
- public/js/chat.js: showStreamingMessage 函数新增 assistantName 参数，显示正确的助手名字
- server.js: chatMessage 处理时使用 displayContent 保存用户消息
- docs/spec/chat-system.md: 更新 sendMessage 伪代码描述

### 2026-03-29 控制端语音播放改用 TTS 服务

**已完成功能：**
- 控制端播放语音改用 TTS 服务生成音频文件
- 移除浏览器 Web Speech API (speechSynthesis) 的使用
- 统一使用服务端 TTS 生成，确保语音一致性

**改动文件：**
- server.js: playOnControl 时调用 tts.generateTTS 生成音频，返回 audioUrl
- public/js/chat.js: playOnControlDevice 改为使用 Audio 对象播放音频文件
- docs/spec/websocket.md: 更新消息格式和处理流程

### 2026-03-29 修复控制端音频播放被打断问题

**已修复问题：**
- 控制端播放多句语音时，旧的句子没播完就被打断了
- 原因：每个句子生成后立即播放，没有等待上一个音频播完

**改动文件：**
- public/js/chat.js: 实现音频播放队列，等待上一个音频播完再播放下一个

### 2026-03-29 修复聊天模板持久化保存问题

**已修复问题：**
- 聊天模板没有保存到文件，重启后丢失
- 模板 id 改为使用名字，名字不能重复
- 私聊 AI 时用模板名字匹配系统提示词
- 私聊验证改用模板列表，而非旧的 assistantConfig
- 私聊消息显示对应 AI 助手名字而非"助手"
- 群聊消息错误地被保存为私聊消息（群聊消息的 target 应为 null）
- 群聊点击语音播放按钮播放的是私聊内容（索引错误）
- 系统帮助指令改用弹窗显示，而非 toast 提示

**新增功能：**
- 只发"私聊"时自动进入第一个模板对应的助手
- 群聊时消息以助手名字开头，自动使用该助手模板回复
- 私聊消息隔离：私聊模式只显示当前助手的私聊消息，群聊不显示私聊消息
- 默认模板：首次启动自动创建"小爱"模板并保存到文件
- 系统消息改为 toast 提示弹出，不再显示在聊天记录中
- 左侧页签快速切换聊天模式（群聊/各助手私聊），切换时自动刷新消息列表
- 群聊模式未指定助手时自动使用第一个模板的助手
- 移除底部模板下拉框，改用左侧页签切换
- 清空消息只清空当前页签对应的消息（群聊清群聊，私聊清对应助手）

**改动文件：**
- core/chat.js: 添加 TEMPLATES_FILE 常量和 loadTemplates/saveTemplates 函数
- core/chat.js: addTemplate 使用名字作为 id，重复名字更新内容
- core/chat.js: 新增 getTemplateByName 函数
- core/chat.js: 添加 DEFAULT_TEMPLATES 常量，首次启动自动创建默认模板
- core/chat.js: clearHistory 支持按模式清空消息
- server.js: 私聊时用 chat.getTemplateByName 匹配模板
- server.js: 群聊时使用 templateTarget 指定模板，消息 target 为 null
- server.js: /api/chat/clear 接收 mode 和 target 参数
- public/js/chat.js: deleteTemplate 改用名字参数
- public/js/chat.js: 私聊验证改用 templates 列表
- public/js/chat.js: sendMessage 检测助手名字开头的消息
- public/js/chat.js: sendMessage 群聊时发送 templateTarget 而非 target
- public/js/chat.js: renderHistory 使用 originalIndex 保留原始索引用于播放
- public/js/chat.js: renderHistory 私聊消息显示 target 作为名字
- public/js/chat.js: addSystemMessage 改为 toast 提示
- public/js/chat.js: handleSystemCommand 系统帮助改用 alert 弹窗
- public/js/chat.js: render 添加左侧页签切换，移除模板下拉框
- public/js/chat.js: setMode 切换时调用 render 刷新消息
- public/js/chat.js: clearHistory 发送 mode 和 target 参数
- public/css/chat.css: 添加页签样式

### 2026-03-29 优化聊天历史记录发送逻辑

**已优化功能：**
- 非私聊模式下不再发送历史记录给 AI 助手
- 私聊模式下保留历史记录以维持对话上下文

**改动文件：**
- core/chat.js: buildMessages 添加 includeHistory 参数
- server.js: 私聊模式传入 includeHistory: true

### 2026-03-29 修复用户消息显示名称问题

**已修复问题：**
- 控制端发送的消息重连后显示为"控制端"而非"用户"
- 原因：renderHistory 没有正确处理 role='control' 的情况

**改动文件：**
- public/js/chat.js: renderHistory 中将 role='control' 映射为用户消息显示

### 2026-03-29 修复聊天记录保存问题

**已修复问题：**
- 聊天名字垂直居中显示
- 聊天记录没有正确保存用户消息
- 原因：chatStream 函数内部使用旧格式保存消息，与 server.js 中新格式保存冲突

**改动文件：**
- public/css/chat.css: 添加 align-self: center 使名字垂直居中
- core/chat.js: 移除 chatStream 内部的消息保存逻辑，由 server.js 统一处理

### 2026-03-29 句子分割支持全角波浪号

**已完成功能：**
- 合成语言时，全角波浪号"～"也作为句子结束符

**改动文件：**
- core/chat.js: isSentenceEnd 函数添加全角波浪号 '～' (U+FF5E)
- docs/spec/websocket.md: 更新句子结束符列表说明

### 2026-03-29 控制端新增搜索页签

**新增功能：**
- 侧边栏新增搜索页签入口
- 显示搜索历史记录列表
- 支持手动输入关键词搜索
- 搜索记录可点击播放结果（TTS 播报）
- 支持删除单条搜索记录
- 支持清空全部搜索历史

**改动文件：**
- public/upload.html: 添加搜索页签 HTML 结构和导航按钮
- public/js/search.js: 新增搜索模块，处理历史显示、搜索、播放、删除操作
- public/js/websocket.js: 添加 searchHistory 消息分发到 Search 模块
- public/js/main.js: 初始化时调用 Search.init()
- public/css/upload.css: 添加搜索页签样式
- docs/spec/search.md: 新增搜索功能规格文档
- docs/spec/sidebar.md: 更新功能模块列表
- docs/spec.md: 更新模块列表
- docs/design/control.md: 更新功能模块描述

**交互流程：**
1. 进入搜索页签自动加载搜索历史
2. 输入关键词点击搜索，发送到服务端执行语音搜索
3. 点击播放按钮，TTS 播放搜索结果摘要
4. 点击删除按钮，删除单条记录
5. 点击清空按钮，清空所有历史

**Bug 修复：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能无需显示端连接即可执行
  - 改动文件：server.js, core/voiceCommand.js, public/js/search.js
  - 问题：服务端处理控制端消息时，如果没有选择显示端会直接 return，导致搜索请求无法处理
  - 修复：将 voiceCommand 相关消息处理移到显示端检查之前，搜索时允许 displayId 为空

**功能优化：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能改用 axios + cheerio 方案
  - 改动文件：core/voiceCommand.js, docs/spec/voiceCommand.md
  - 改进：使用 axios + cheerio 替代 puppeteer，更轻量、更稳定
  - 特性：
    - 支持 AI 回答 (#b_pole 区域)
    - 支持普通搜索结果 (li)
    - 无需启动浏览器，响应更快
    - AI 回答内容限制 500 字符

### 2026-03-29 实现语音命令处理功能

**新增功能：**
- 显示端语音状态显示：识别到语音时更新状态为"语音识别中"，显示语音识别文字
- 提醒功能：支持"X分钟后"、"每天"、"每周"、"每月"、"每年"等时间表达式
- 报时功能：支持"报时"、"现在几点"、"开启/关闭报时"语音命令
- 搜索功能：支持"搜索XXX"语音命令，搜索结果语音播报并显示
- AI助手响应：支持自定义助手名字（默认"小爱"），触发对应助手响应

**改动文件：**
- core/voiceCommand.js: 新增语音命令处理模块
- server.js: 集成语音命令模块，添加 WebSocket 消息处理
- public/display.html: 添加语音文字显示、命令响应弹窗
- public/css/display.css: 添加语音状态和弹窗样式
- public/js/chat.js: 更新语音命令处理逻辑
- public/js/websocket.js: 添加搜索历史和助手配置消息处理
- docs/spec/voiceCommand.md: 新增语音命令实现文档
- docs/spec.md: 更新模块列表

**语音命令触发流程：**
- "提醒" -> 解析时间和重复规则 -> 语音确认 -> 添加提醒
- "报时/现在几点" -> 立刻报时
- "开启/关闭报时" -> 切换报时功能状态
- "搜索XXX" -> 执行搜索 -> 语音播报结果
- "小爱XXX" -> 触发对应助手响应

### 2026-03-29 优化 SMB 媒体库配置界面

**改进内容：**
- 将 SMB 共享路径拆分为"服务器地址"和"共享路径"两个独立字段
- 服务器地址：输入 SMB 服务器 IP 或域名（如 `192.168.1.100`）
- 共享路径：输入共享名称，不需要包含服务器地址（如 `share` 或 `share/subfolder`）

**改动文件：**
- public/js/media-library.js: 添加服务器地址输入框，修改表单验证逻辑
- core/media-library.js: SmbProvider 添加 `_buildSharePath` 方法，支持 server 和 share 参数组合
- server.js: POST 路由添加 server 字段解构
- docs/spec/media-library.md: 更新配置结构说明

### 2026-03-29 改进 SMB 连接错误提示

**改进内容：**
- 添加 SMB 共享路径格式验证，提供更清晰的错误提示
- 错误 `name invalid` 通常是路径格式不正确导致

**改动文件：**
- core/media-library.js: `connect` 方法添加路径格式验证

**SMB 共享路径格式：**
- Windows 风格：`\\服务器IP\共享名`（前端输入时需转义为 `\\\\服务器IP\\共享名`）
- Unix 风格：`//服务器IP/共享名`

### 2026-03-29 修复 Node.js 17+ SMB 连接加密算法不支持错误

**已修复问题：**
- Node.js 17+ 使用 OpenSSL 3.0，默认禁用了 SMB 认证需要的旧加密算法（DES/MD4）
- 错误：`Error: error:0308010C:digital envelope routines::unsupported`

**改动文件：**
- package.json: 添加 `start:legacy` 脚本，使用 `--openssl-legacy-provider` 参数启动

**使用方式：**
- `npm start` 默认启用 SMB 支持

### 2026-03-29 修复 HTTP 媒体库配置保存丢失 URL 字段

**已修复问题：**
- 控制端添加 HTTP 类型媒体库后，重启服务端报错：`Cannot read properties of undefined (reading 'replace')`
- 原因：`saveConfig` 方法保存配置时只保存了 `path` 字段，没有保存 HTTP/SMB 类型需要的 `url`、`username`、`password` 等字段

**改动文件：**
- core/media-library.js: 修复 `saveConfig` 方法，根据媒体库类型保存对应字段

---

## 历史记录

### 2026-03-29 显示端语音识别状态显示

**已完成功能：**
- 控制端显示端列表显示语音识别状态图标
- 状态图标：🎤 识别中（闪烁动画）、🎤 就绪（半透明）、🎤 不支持（灰色）

**改动文件：**
- public/display.html: 添加 sendVoiceStatus 函数上报语音状态
- server.js: 添加 voiceStatus 消息处理和状态存储
- public/js/display-list.js: 渲染语音状态图标
- public/css/upload.css: 添加语音状态样式和动画

### 2026-03-29 修复媒体库符号链接访问错误

**已修复问题：**
- 本地媒体库遇到损坏的符号链接时抛出 ENOENT 错误

**改动文件：**
- core/media-library.js: 使用 lstatSync 代替 statSync，跳过损坏的符号链接

### 2026-03-29 显示端语音识别转发到控制端

**已完成功能：**
- 显示端启动时自动启动语音识别
- 语音识别结果通过 WebSocket 转发到控制端
- 控制端 Chat 模块接收显示端语音输入
- 支持在显示端说"聊天xxx"触发控制端对话

**改动文件：**
- public/display.html: 添加语音识别初始化和结果发送
- server.js: 添加 voiceInput 消息转发
- public/js/websocket.js: 添加 voiceInput 消息处理
- public/js/chat.js: 添加 handleDisplayVoiceInput 方法
- docs/spec/websocket.md: 更新消息类型文档
- docs/design/display.md: 更新设计文档

### 2026-03-29 语音输入功能

**已完成功能：**
- 控制端添加语音输入按钮
- 支持语音识别（Web Speech API）
- 说"聊天xxx"触发语音对话，自动发送消息给 AI 助手
- AI 回复后自动播放到显示端

**改动文件：**
- public/js/chat.js: 添加语音识别功能和语音命令处理
- public/css/chat.css: 添加语音输入按钮样式
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 优化媒体库 URL 生成

**已优化功能：**
- 默认 uploads 目录使用静态文件服务 `/uploads/`
- 其他本地目录使用动态静态路由 `/media/{id}/`
- HTTP 媒体库直接使用原始 HTTP 路径，不走代理

**改动文件：**
- core/media-library.js: LocalProvider 添加动态路由支持，HttpProvider 直接返回原始 URL
- server.js: 初始化时动态添加本地媒体库静态路由，确保路由在服务器启动前注册
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 聊天语音手动播放句子分割

**已完成功能：**
- 聊天语音手动播放时，进行句子分割
- 长文本按句子分批生成 TTS 并播放

**改动文件：**
- server.js: TTS play action 处理逻辑添加句子分割
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 修复 TTS 语音播报 404 错误

**已修复问题：**
- 显示端语音播报播不出来
- 整点报时无法正常播放
- 原因：TTS 文件路径改为 `uploads/tts/`，但多处代码返回的 URL 仍是 `/uploads/xxx`
- 修复：所有 TTS 相关代码返回正确的 URL `/uploads/tts/${fileName}`

**改动文件：**
- server.js: /api/tts/generate 和 Chat TTS 返回正确的 audioUrl
- core/timeAnnounce.js: 整点报时返回正确的 audioUrl
- core/reminder.js: 提醒功能返回正确的 audioUrl

### 2026-03-29 修复本地媒体库播放 404 错误

**已修复问题：**
- 新增的本地媒体库播放报错 404 Not Found
- 原因：本地媒体库 URL 错误地使用 `/uploads/` 路径，但服务器只映射了 `./uploads` 目录
- 修复：所有本地媒体库统一使用代理 API `/api/media-libraries/{id}/proxy/`

**改动文件：**
- core/media-library.js: LocalProvider.getPublicUrl 使用代理 API
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 AI 聊天助手播放功能

**已完成功能：**
- AI 聊天助手每条消息添加播放按钮
- 点击播放按钮通过 TTS 播放聊天内容

**改动文件：**
- public/js/chat.js: 添加 playMessage 方法，renderHistory 添加播放按钮
- public/css/chat.css: 添加播放按钮样式
- docs/spec/websocket.md: 添加 Chat 模块伪代码描述

### 2026-03-29 TTS 文件存储路径调整

**已完成功能：**
- TTS 生成的音频文件保存到 `uploads/tts/` 文件夹

**改动文件：**
- core/tts.js: 修改 TTS 文件保存路径

### 2026-03-29 控制端媒体库管理

**已完成功能：**
- 控制端添加媒体库 UI（添加/编辑/删除媒体库）
- 支持添加本地磁盘、HTTP远程、SMB网络共享三种类型媒体库
- 编辑媒体库：修改名称、只读模式、设为默认
- 删除媒体库

**改动文件：**
- public/js/media-library.js: 添加 showAddLibraryDialog, showEditLibraryDialog, onTypeChange, addLibraryFromForm, updateLibraryFromForm, deleteLibrary 方法
- public/css/media-library.css: 添加模态框和表单样式
- core/media-library.js: addLibraryFromConfig 支持 HTTP 和 SMB 类型配置
- server.js: POST /api/media-libraries 支持更多参数
- docs/spec/media-library.md: 更新伪代码描述

### 提醒功能
- 提醒类型：临时提醒、每天提醒
- 提醒方式：语音播报、弹窗提示
- 每次提醒重复次数：每次触发时重复播报/弹窗的次数（1-10次）
- 重复提醒：触发后按间隔时间再次提醒
- 编辑提醒：支持编辑已创建的提醒
- 单独测试提醒：可测试单条提醒，支持发送到选中显示端或所有显示端
- 媒体管理界面显示端选择：在媒体管理界面也可以选择显示端

### Bug 修复
- 修复提醒编辑弹窗无法显示问题（`.chat-modal-overlay.active` CSS 样式缺失）

### 配置文件目录
- 配置文件统一迁移到 `config/` 目录
  - `config/config.json` - 主配置文件
  - `config/chat-history.json` - 聊天历史记录
  - `config/media-libraries.json` - 媒体库配置
  - `config/reminders.json` - 提醒配置

### 显示端语音功能
- 显示端支持通过 tts.js 生成语音功能

### 控制端功能
- 合并播放和暂停按钮
- 画面填充和旋转按钮选中状态背景颜色切换
- 本地配置表（保存端口配置、语音服务地址等）
- 控制端媒体列表标注当前播放的媒体
- 保存显示端当前播放列表、画面填充设置
- 服务端重启按钮

### 页面交互
- 界面左侧页签导航

### 控制端查看显示端信息
- 显示端 navigator.userAgent
- 控制端显示列表新增详情按钮

### CSS 文件拆分
- display.html CSS 拆分到 `public/css/display.css`
