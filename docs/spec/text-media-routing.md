# 文本媒体语音路由与批量类型筛选实现规范

## 控制端批量设置伪代码

```text
显示批量设置弹窗:
    渲染五个复选框 text/audio/image/video/web
    默认全部勾选
    不读取媒体库当前列表做本地类型筛选

用户确认:
    mediaTypes = 读取被勾选复选框的 value
    发送 playlistRequest(..., mediaTypes)
    不读取文件列表
    不在控制端删除或过滤文件
```

## 服务器播放列表筛选伪代码

```text
normalizeMediaTypes(input):
    if input 不是数组 或 input 为空:
        return 全部媒体类型
    逐项将 web 映射为 html，将 image 扩展为 image/gif
    丢弃未知项
    if 结果为空:
        return 全部媒体类型
    return 规范化集合

buildFromLibrary/buildFromTemp(options):
    allowed = normalizeMediaTypes(options.mediaTypes)
    收集全部媒体项
    仅保留媒体类型在 allowed 中的项
    按已有 mode/sortBy/direction 排序
    映射为显示端播放列表

server-app 处理 playlistRequest:
    原样透传 data.mediaTypes 给 PlaylistManager
    不在 server-app 内复制一套类型映射逻辑
    mediaTypes 缺失时继续兼容旧客户端
```

## 语音目标伪代码

```text
resolveTextVoiceTarget(originDisplayId, selectedDisplayIds, currentTarget = null, isPrefetch = false):
    available = 读取全部当前在线且 voicePlayback=true 的显示端，保持稳定顺序
    if isPrefetch:
        if currentTarget 不在 available:
            返回“当前语音设备不可用，取消预取”
        return currentTarget
    if originDisplayId 在 available:
        return originDisplayId
    return available 中第一个显示端

处理媒体/playlistRequest:
    initialRoute = resolveTextVoiceTarget(当前显示端, selectedDisplayIds)
    把 initialRoute 和 selectedDisplayIds 随文本媒体/playlistStart 下发并持久化

处理 textSentenceTts(origin, data):
    校验 playbackId/page/sentence/text
    在串行队列执行开始时读取全部当前 OPEN 且 voicePlayback=true 的显示端
    if data.prefetch:
        target = resolveTextVoiceTarget(origin, selectedDisplayIds, 当前句实际目标, true)
        如果目标失效:
            返回带 prefetch=true 的可定位错误，实际下一句重新选择目标
    else:
        target = resolveTextVoiceTarget(origin, selectedDisplayIds, 当前句实际目标, false)
    更新当前播放上下文的 voiceTargetDisplayId = target
    按本次请求实际 target 记录句子目标
    生成或读取句子音频
    如果生成成功且请求仍有效:
        再次读取全部当前 OPEN 且 voicePlayback=true 的显示端
        如果是预取:
            如果当前句目标已失效:
                返回带 prefetch=true 的可定位错误，取消本次预取
            否则沿用当前句目标
        否则按源端优先规则重新选择 target
        没有 target 时回 origin 发送可定位 textSentenceTtsError
    if target == origin:
        发送 textPlayback 音频给 origin
    else if target 在线且可语音播放:
        发送 textPlaybackRemote 音频给 target，附 originDisplayId
    else:
        回 origin 发送可定位 textSentenceTtsError

处理 textSentenceTtsFinished(target, data):
    按 playbackId/pageIndex/sentenceIndex 查找本句登记的实际 target
    校验 target、origin、playbackId 和句子定位
    动态路由下不重新检查 target 当前 voicePlayback，已登记的合法回执继续生效
    将结束或失败消息转发给 origin

取消文本播放上下文:
    收到 pause/prev/next/stop:
        如果 activePlayback 的语音目标是远程显示端:
            先向 voiceTargetDisplayId 发送 tts(textPlaybackRemote=true, action=stop, originDisplayId, voiceTargetDisplayId, playbackId)
        使用源显示端和 playbackId 删除 activePlaybacks、pendingRemoteSentences、prefetchedSentence
        远程显示端迟到 textSentenceTtsFinished:
            因上下文不存在或 token 不匹配被丢弃
```

## 下一句预生成伪代码

```text
每个 originDisplayId 维护 playbackContext:
    playbackId
    selectedDisplayIds
    voiceTargetDisplayId
    activeSentence
    prefetchedSentence = null
    token

收到 textSentenceTts:
    if prefetch 且已有 prefetchedSentence:
        忽略重复请求
    串行执行 TTS 生成
    if token 仍有效:
        if prefetch:
            保存音频到 prefetchedSentence
            if voiceTargetDisplayId 是源显示端:
                回源端 tts(textPlayback=true, prefetch=true, audioUrl, 定位)
            else:
                发送远程目标 tts(textPlaybackRemote=true, prefetch=true, originDisplayId, 定位)
                pendingRemoteSentences 写入预生成句定位
                回源端 textSentenceTtsReady(prefetch=true, 定位)
        else:
            发送当前句音频
            if 远程目标:
                pendingRemoteSentences 写入当前句定位

源显示端收到当前句音频:
    播放当前句
    若存在下一句:
        如果预取槽为空:
            请求下一句并标记 prefetch=true

当前句 ended/remote finished:
    若 prefetchedAudio 已缓存:
        立即播放缓存句
        清空预取槽
        播放缓存句后继续预取它的下一句
    否则若预取请求正在生成:
        等待预取回包，不重复请求
    否则请求并等待下一句
    若预取错误:
        清空预取槽并按普通请求回退当前目标句

pause/prev/next/stop/新 playbackId:
    令 token 失效
    如果当前上下文使用远程语音目标:
        服务端发送远程 stop 消息
        远程显示端暂停当前远程文本音频
        远程显示端清理 remoteTextPlayback 和 remotePrefetchedTextPlayback
    清理源端、远程端和服务端的 prefetchedSentence/pendingRemoteSentences
    忽略旧 playbackId 或旧 token 的预取回包/ready/finished

远程显示端收到 textPlaybackRemote(prefetch=true):
    如果 originDisplayId/voiceTargetDisplayId/playbackId 与当前远程上下文不同:
        清理旧 remoteTextPlayback 和 remotePrefetchedTextPlayback
    如果已经有远程预取槽:
        仅当同一 origin/target/playback/pageIndex/sentenceIndex 时丢弃重复预取
    否则缓存为 remotePrefetchedTextPlayback
    不改写当前 ttsAudio.src，不发送 finished

远程显示端收到 textPlaybackRemote(action=stop):
    如果 originDisplayId/voiceTargetDisplayId/playbackId 匹配当前远程上下文或预取槽:
        递增 remoteTextPlaybackToken
        暂停 ttsAudio
        currentTime = 0
        清空 remoteTextPlayback
        清空 remotePrefetchedTextPlayback
    旧 ended/error 回调发现 token 不匹配:
        只清理监听器
        不发送 finished
        不消费预取槽

远程当前句 ended/failed:
    发送当前句 textSentenceTtsFinished
    如果 remotePrefetchedTextPlayback 匹配同一 origin/target/playback 且 pageIndex 相同、sentenceIndex = 当前句 sentenceIndex + 1:
        清空远程预取槽
        自动播放缓存句
        缓存句 ended/failed 后再发送它自己的 finished
    否则:
        清理当前远程上下文
```

## 手动能力伪代码

```text
控制端保存能力:
    发送 updateCapabilities({ displayId, capabilities })

服务器:
    state.userCapabilities = capabilities
    state.capabilities = DEFAULT_CAPABILITIES + capabilities
    显示端再次上报 capabilities 时:
        state.capabilities = DEFAULT_CAPABILITIES + 自动能力
        覆盖 state.userCapabilities
```

## 受影响代码

- `media-library.js`：批量类型复选框，只产生 `mediaTypes`。
- `playlist-app-service.js`、`server-app.js`：服务器筛选和文本语音目标计算。
- `text-media-tts-service.js`、`text-media-ws-integration.js`：预生成、远程音频、结束回执和取消。
- `text-media-player.js`、`display.html`：下一句缓存、远程语音播放及回执。
- `display-list.js`/`device-list.js`：手动语音能力说明与保存协议保持一致。

## Task 1 reviewer fix2 约束

```text
upload.prepareTempFiles(files):
    使用 files 当前循环索引 currentIndex 遍历每个文件
    构建 tempItem 后:
        如果存在 TempPlaylistPreview:
            tempItem.tempPreviewKey = TempPlaylistPreview.createKey(tempItem, currentIndex)
    不引用未定义的循环变量
    保持原有读取顺序、错误吞吐和批量入口行为不变

showBatchTempUpload(files):
    继续复用 prepareTempFiles(files)
    items.length > 0 时才能发送 temp 批量 playlistRequest
```

## Task 2 手动语音路由落地伪代码

```text
控制端能力编辑器:
    voicePlayback 说明 = "语音播放为手动路由开关，开启后可作为文本TTS播报设备"
    保存时仍发送 updateCapabilities(displayId, capabilities)
    不新增自动无扬声器能力上报

服务器合并能力:
    收到控制端 updateCapabilities:
        state.userCapabilities = capabilities
        state.capabilities = DEFAULT_CAPABILITIES + capabilities
    收到显示端 capabilities:
        state.capabilities = DEFAULT_CAPABILITIES + 自动能力
        如果存在 userCapabilities:
            userCapabilities 覆盖自动能力

mediaBatch 文本媒体:
    对每个目标 displayId:
        route = buildTextVoiceRoute(displayId, 本次 displayIds)
        TextMediaTtsService.setDisplayRoute(displayId, route)
        media.route = route
        media.selectedDisplayIds = route.selectedDisplayIds
        media.selectedVoiceDisplayIds = route.selectedVoiceDisplayIds
        media.voiceTargetDisplayId = route.voiceTargetDisplayId
        保存 currentMedia 时保留这些字段
        只向该 displayId 下发该 route
    如果媒体不是 text:
        TextMediaTtsService.clearDisplayRoute(displayId)

playlistRequest:
    voiceRouteByDisplayId = {}
    对每个本次选中的 displayId:
        voiceRouteByDisplayId[displayId] = buildTextVoiceRoute(displayId, 本次 displayIds)
    playlistStart 下发:
        selectedDisplayIds
        selectedVoiceDisplayIds
        voiceTargetDisplayId = 当前接收显示端自己的目标
        voiceRouteByDisplayId
    对每个已实际下发 playlistStart 的 displayId:
        TextMediaTtsService.setDisplayRoute(displayId, voiceRouteByDisplayId[displayId])
    currentPlaylist.startData 持久化同一批字段

TextMediaPlayer:
    load/loadRoute 读取 route
    请求 textSentenceTts 时携带 route
    收到 textSentenceTtsFinished:
        如果 playbackId/pageIndex/sentenceIndex 匹配当前句:
            视为当前句已结束并请求下一句

远程语音显示端:
    收到 tts + textPlaybackRemote:
        播放 audioUrl
        ended 发送 textSentenceTtsFinished(status=ended)
        error 发送 textSentenceTtsFinished(status=failed)

TextMediaTtsService:
    route 缺失:
        兼容旧协议，按源显示端 textPlayback 回包
    setDisplayRoute(originDisplayId, trustedRoute):
        如果旧 activePlaybackContext 使用远程语音目标:
            先向旧 voiceTargetDisplayId 发送远程 stop
        记录服务器计算的 selectedDisplayIds/selectedVoiceDisplayIds/voiceTargetDisplayId
        新媒体或新 playlist 覆盖同 originDisplayId 的旧 route
    clearDisplayRoute(originDisplayId):
        如果旧 activePlaybackContext 使用远程语音目标:
            先向旧 voiceTargetDisplayId 发送远程 stop
        删除服务器注册 route
        删除该 originDisplayId 的 activePlaybackContext、pendingRemoteSentences、prefetchSlot
    收到 textSentenceTts:
        如果存在服务器注册 route:
            使用服务器注册 route 建立 activePlaybackContext
            忽略显示端请求里的 route
        如果不存在服务器注册 route 且请求没有 route:
            兼容旧协议，按源显示端 textPlayback 回包
        如果不存在服务器注册 route 但请求携带 route:
            拒绝请求并回源端 textSentenceTtsError
        在队列执行开始和音频发送前按动态规则重新选择 target
        如果目标是源端:
            发送 textPlayback
        如果目标是远程:
            确认目标在发送前仍在线且 voicePlayback=true 后发送 textPlaybackRemote(originDisplayId)
            pendingRemoteSentences 写入 playbackId/pageIndex/sentenceIndex/targetDisplayId 对应 token
        目标不存在或不可用:
            回源端 textSentenceTtsError
    收到 textSentenceTtsFinished:
        校验来源显示端、playbackId 和句子定位
        校验 pendingRemoteSentences 存在相同 targetDisplayId/playbackId/pageIndex/sentenceIndex
        动态路由下不因目标设备当前 voicePlayback 状态变化拒绝已登记回执
        校验通过后删除 pendingRemoteSentences 对应 token
        转发 textSentenceTtsFinished 给 originDisplayId
    cancel(originDisplayId, playbackId):
        如果 activePlaybackContext 匹配 playbackId 且使用远程语音目标:
            向 voiceTargetDisplayId 发送 tts(textPlaybackRemote=true, action=stop, originDisplayId, voiceTargetDisplayId, playbackId)
        删除 activePlaybackContext 使 pendingRemoteSentences 和 prefetchSlot 全部失效
        保留服务器注册 route 以支持暂停后同一媒体恢复

    cancel(originDisplayId) 不带 playbackId:
        用于批量 pause/prev/next/jump
        取消当前 activePlaybackContext，但保留已注册 route

    远程句子 pending:
        当前句设置有限完成超时
        预取句在当前句完成后再开始完成超时计时
        超时或目标断连时向源端发送带定位 textSentenceTtsError
        清理同一上下文的其它 pending/pre-fetch，并向远程目标发送 stop

    显示端断连:
        TextMediaTtsService.handleDisplayDisconnect(displayId)
        目标断连时失败关联源端句子并删除 activePlaybackContext
        源端断连时清理自身上下文，但保留 route 供重连恢复

    服务重启后显示端重连:
        从 currentMedia 或 currentPlaylist.startData 读取持久化文本 route
        只对当前文本项重新调用 setDisplayRoute
        重新按已选设备和当前手动 voicePlayback 状态校验目标
        若历史目标暂时离线，保留服务器此前选中的目标，实际请求时再返回离线错误
```

## Task 4 核对状态

- 2026-08-24 已按当前实现复核本 spec 与 Task 1/2/3 落地结果一致：
  - Task 1：`PlaylistManager` 统一执行 `mediaTypes` 规范化，`server-app` 仅透传字段。
  - Task 2：`TextMediaTtsService.setDisplayRoute/clearDisplayRoute` 作为服务器权威 route 上下文，远程 `textSentenceTtsFinished` 需匹配 pending 定位后才转发。
  - Task 3：每个播放上下文只保留一个 `prefetchSlot`，远程 stop 会清理当前句与预取槽，旧 token/旧 playbackId 回包全部失效。
- 详细测试、`node --check` 与 `git diff --check` 结果见 `.superpowers/sdd/2026-08-24-text-media-routing/task-4-implementation-report.md`。

## Task 5 审查修复状态

- 2026-08-24 已修复最终审查发现的批量控制取消、远程设备断连/超时、服务重启 route 恢复和远程预取暂停恢复问题。
- `mediaTypes` 契约明确为：混合输入保留合法值；只有缺失、空数组或规范化后无合法值时才按全部类型处理。
- 新增 4 个远程 TTS/播放器回归用例和 2 个服务器恢复/批量控制协议检查用例；修复后相关测试 41/41 通过。
- 超时回调先删除旧 `activePlaybackContext`，再发送远程 stop 和可定位错误；迟到的预取生成完成后必须因旧 token 失效而丢弃。
