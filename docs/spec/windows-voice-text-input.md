# Windows 子显示端语音转文字输入实现文档

## 数据结构

```text
WindowsTextInputState:
    mode: inactive | active
    history: 按注入顺序保存的 TextInputRecord 列表
    lastWindowId: 最近一次成功注入的前台窗口标识
    announcement: null 或 { requestId, mode, state: pending | playing | waiting-queue | finished | failed }
    idleTimer: active 模式最后一次成功操作后的 30 秒定时器
    voiceprintPolicy: inherit | false，只保存在 Node 子显示端
    serverVoiceprintEnabled: 由服务器 voiceprintConfig.enabled 下发的当前值

TextInputRecord:
    text: 本次完整 ASR 文本
    windowId: 注入时的前台窗口标识
```

## Windows 输入注入器伪代码

```text
WindowsTextInputInjector:
    初始化:
        如果当前平台不是 win32:
            available = false
        否则:
            available = true
        operationQueue = 空 Promise 队列

    enqueue(operation):
        将 operation 接到 operationQueue 尾部
        operation 完成或失败后释放队列占用
        返回 operation 结果

    insertText(text):
        校验 available 和非空 text
        加入串行队列:
            windowId = Windows 获取当前前台窗口标识
            保存当前 Unicode 文本剪贴板
            设置 Unicode 文本剪贴板为 text
            使用 SendInput 向 windowId 发送 Ctrl+V
            等待粘贴事件完成
            恢复原文本剪贴板
            返回 { success, windowId, text }

    PowerShell 输出:
        设置 Console.OutputEncoding 为 UTF-8
        C# INPUT 联合体包含 MOUSEINPUT、KEYBDINPUT、HARDWAREINPUT
        SendInput 失败时返回 Win32 错误码

    sendEnter(expectedWindowId):
        加入串行队列:
            currentWindowId = Windows 获取当前前台窗口标识
            如果 currentWindowId != expectedWindowId:
                返回 { success: false, reason: 'window-changed' }
            使用 SendInput 发送 Enter
            返回 { success: true, windowId: currentWindowId }

    backspaceText(record):
        加入串行队列:
            currentWindowId = Windows 获取当前前台窗口标识
            如果 currentWindowId != record.windowId:
                返回 { success: false, reason: 'window-changed' }
            graphemeCount = 按用户可见字符计算 record.text 数量
            重复 graphemeCount 次发送 Backspace
            返回 { success: true, windowId: currentWindowId }

    close():
        终止快捷键监听子进程
        等待或取消后续注入操作
```

## 全局快捷键伪代码

```text
WindowsGlobalHotkey:
    Windows 平台:
        注册 Ctrl+Alt+Space
        启动隐藏消息循环
        收到 WM_HOTKEY:
            调用 onToggle()
        另一个实例注册 Alt+C
        Alt+C 收到 WM_HOTKEY 时调用 onToggleVoiceprintPolicy()
        注册失败:
            回报 unavailable 和错误
    非 Windows 平台:
        直接回报 unavailable

    close:
        注销热键
        结束消息循环子进程
```

## Node 子显示端语音输入伪代码

```text
VoiceDisplay 初始化:
    textInputMode = inactive
    textInputHistory = 空列表
    textInputIdleTimer = null
    textInputVoiceprintPolicy = config.textInput.requireVoiceprint，仅接受 inherit 或 false，默认 inherit
    serverVoiceprintEnabled = true
    创建 WindowsTextInputInjector
    创建 WindowsGlobalHotkey(onToggleTextInputMode)
    创建 WindowsGlobalHotkey(Alt+C, toggleTextInputVoiceprintPolicy)

有效输入模式声纹策略:
    如果 textInputVoiceprintPolicy == false:
        requireVoiceprint = false
    否则:
        requireVoiceprint = serverVoiceprintEnabled

服务器 voiceprintConfig:
    保存 data.enabled 到 serverVoiceprintEnabled
    textInputVoiceprintPolicy == inherit 时，后续输入立即使用新的服务器值

Alt+C:
    如果 textInputVoiceprintPolicy == inherit:
        改为 false
    否则:
        改为 inherit
    将该选择只持久化到当前 Node 子显示端配置文件
    仅记录本地切换结果，不暂停录音、不请求 TTS

onToggleTextInputMode:
    如果 textInputMode == inactive:
        进入 active
        清空 textInputHistory
        记录“Windows语音输入已开启”
        暂停 recorder
        请求当前显示端播报“已开始输入”
        播报完成或失败后恢复 recorder
    否则:
        退出 active
        清空 textInputHistory
        记录“Windows语音输入已关闭”
        暂停 recorder
        请求当前显示端播报“已结束输入”
        播报完成或失败后恢复 recorder

结束输入命令:
    退出 active
    清空 textInputHistory
    暂停 recorder
    请求当前显示端播报“已结束输入”
    播报完成或失败后恢复 recorder

处理 ASR 返回:
    获取完整最终文本和服务端 localTextInputAction
    如果 localTextInputAction == activate:
        进入 active
        清空 textInputHistory
        结束当前处理

    如果 textInputMode == inactive:
        保持现有 ASR 结果展示和服务端处理语义
        结束当前处理

    如果有效输入模式声纹策略要求匹配:
        只保留带有非空 speaker 的 ASR 分段
        如果没有匹配分段:
            记录未通过声纹匹配
            不注入文字，不执行“发送”“返回”“结束输入”
            结束当前处理

    如果文本 == “发送”:
        使用最近记录的 windowId 执行 sendEnter
        成功后清空 history，保持 active，并刷新 30 秒无操作计时器
        失败则记录窗口变化并保留 active/history
        结束当前处理

    如果文本 == “返回”:
        取 history 最后一条记录
        不存在则结束当前处理
        执行 backspaceText(record)
        成功后移除最后一条记录
        刷新 30 秒无操作计时器
        失败则保留记录并记录窗口变化
        结束当前处理

    如果文本 == “结束输入”:
        退出 active
        清空 history
        播报结束提示并在提示结束后恢复 recorder
        结束当前处理

    普通文本:
        执行 insertText(text)
        成功后 history 追加 { text, windowId }，刷新 30 秒无操作计时器
        失败只记录错误，不发送 voiceInput

30 秒无操作计时器:
    进入 active 时启动
    发送成功、返回成功、普通文本注入成功时重新计时
    定时器到期且仍为 active 时调用 exitTextInputMode('30秒无输入', true)
    结束输入、快捷键关闭、停止进程时清除
```

## ASR 请求与服务端伪代码

```text
Node ASR 请求:
    multipart 增加 textInputClient=true
    如果 textInputMode == active:
        增加 localTextInputMode=active
        计算 effectiveRequireVoiceprint:
            voiceprintPolicy == false 时为 false
            voiceprintPolicy == inherit 时取最近一次 serverVoiceprintEnabled
        增加 localTextInputRequireVoiceprint=effectiveRequireVoiceprint

服务端转发显示端 ASR:
    仅当 localTextInputMode == active 且请求携带 localTextInputRequireVoiceprint 时，
    在 asrAudio 消息中增加 useVoiceprint=localTextInputRequireVoiceprint
    未携带时保持显示端原有全局 voiceprintConfig 行为

显示端 ASR:
    useVoiceprint = data.useVoiceprint == false ? false : 全局声纹开关和模型就绪状态
    useVoiceprint == false 时只执行 ASR，不提取 embedding、不执行声纹匹配
    返回 voiceprintElapsedMs=null，且不返回 speaker、similarityScore 或声纹分段

Node 提示请求:
    暂停 recorder
    发送 textInputAnnouncement={ requestId, text, displayId }
    收到带 requestId 的 TTS 播放任务后加入本地音频队列
    本地音频队列完全空闲或播放失败/停止时恢复 recorder
    状态提示不参与 voiceTtsPlaybackState 全局录音门控，也不等待其他显示端回报

服务端 /api/asr/recognize:
    识别音频并规范化 text/segments
    如果 textInputClient == true 且结果是精确“开始输入”:
        返回 status=success、text、localTextInputAction=activate、processedByServer=false
        不调用 processDisplayVoiceInput
    如果 localTextInputMode == active:
        返回 status=success、text/segments、localTextInputAction=text、processedByServer=false
        不广播控制端、不调用 voiceCommand
    否则:
        按现有 sourceDisplayId 和 processRecognizedAsrResultForDisplay 处理
        返回现有兼容响应

服务端 textInputAnnouncement:
    校验来源为在线子显示端
    复用 generateTtsWithFallback 生成提示音
    只向请求来源显示端下发带 requestId 的 tts 消息
    标记该消息为本地状态提示，sendToDisplay 不创建 voiceTtsPlaybackId
    不广播 voiceTtsPlaybackState，避免状态提示永久阻塞来源端录音恢复
    生成或下发失败时回传 textInputAnnouncementError
    在显示端消息注册表中允许 textInputAnnouncement 上行

AudioPlayer:
    播放队列项允许携带完成回调
    当前队列完全空闲后再通知 Node 提示播报结束
```

## 实际代码映射

```text
src/apps/voice-display-node/windows-text-input.js:
    封装 PowerShell/Win32 前台窗口、Unicode 剪贴板、Ctrl+V、Backspace、Enter 和全局热键
    通过 Promise 队列串行化系统输入操作，并在停止时清理子进程

src/apps/voice-display-node/main.js:
    在 VoiceDisplay 内维护 textInputMode、textInputHistory、textInputIdleTimer 和本地声纹策略
    启动时注册 Ctrl+Alt+Space 与 Alt+C 两个 WindowsGlobalHotkey，ASR 返回后分流普通文本、返回和发送
    只在本地保存 textInput.requireVoiceprint，inherit 时读取服务器最新 voiceprintConfig.enabled
    用请求开始时的输入模式快照避免快捷键与在途 ASR 结果串路

src/apps/voice-display-node/asr-client.js:
    Windows 本地输入客户端请求增加 textInputClient、localTextInputMode 和 active 请求的 localTextInputRequireVoiceprint 表单字段

src/apps/server/boot/server-app.js:
    解析 localTextInputRequireVoiceprint，仅在 active 本地输入请求中转成 asrAudio.useVoiceprint
    未携带请求级字段时不改变旧显示端的全局声纹行为

src/apps/web-mediacenter/ui/public/display.html:
    读取 asrAudio.useVoiceprint；明确 false 时跳过本次原生 ASR 的声纹流程

src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt:
    useVoiceprint == false 时仅执行 ASR，并返回 voiceprintElapsedMs=null

src/apps/voice-display-node/audio-player.js:
    播放队列项支持 onComplete，并在队列完全空闲时通知状态提示流程

src/apps/server/boot/server-app.js:
    解析本地输入上下文
    在 /api/asr/recognize 的 server/display ASR 分支先构造本地输入响应
    本地输入请求不调用 processRecognizedAsrResultForDisplay
    注册 textInputAnnouncement 并只向来源子显示端下发不参与全局播放门控的状态提示 TTS
```

## 测试伪代码

```text
WindowsTextInputInjector 测试:
    非 Windows 平台明确不可用
    insertText 串行执行并返回窗口标识
    windowId 变化时 backspace/sendEnter 拒绝执行
    返回按最近记录文本的可见字符数发送 Backspace

Node 子显示端契约测试:
    快捷键切换 active/inactive
    localTextInputAction=activate 激活且不发送 voiceInput
    active 普通文本调用 insertText
    active “返回”只处理最近一条记录
    active “发送”调用 Enter 但保持模式，随后 30 秒无操作自动结束并播报
    active “结束输入”退出模式且不调用 insertText
    inherit 跟随服务器 voiceprintConfig.enabled，false 放行输入模式 ASR
    Alt+C 在 inherit/false 间切换并只修改本地配置
    开始/结束提示期间暂停录音，播报结束后恢复
    active ASR 请求包含本地输入标记

服务端契约测试:
    textInputClient 的“开始输入”旁路服务端命令链路
    localTextInputMode=active 不调用 processDisplayVoiceInput
    textInputAnnouncement 只向来源子显示端下发 TTS，失败回传错误
    voiceRecordingConfig 和 displayRecordingRequest 已由 Node 显示端处理，不再打印未知消息
    未带本地标记的旧请求继续进入原语音处理链路
```
