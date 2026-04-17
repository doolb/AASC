# Web MediaCenter - 变更日志

## [Unreleased]

### 新功能
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
