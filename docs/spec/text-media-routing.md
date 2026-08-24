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
resolveTextVoiceTarget(originDisplayId, selectedDisplayIds):
    selected = 去重并只保留当前在线显示端
    if originDisplayId 在 selected 且 origin.voicePlayback 为 true:
        return originDisplayId
    return selected 中第一个 voicePlayback 为 true 的显示端

处理媒体/playlistRequest:
    route = resolveTextVoiceTarget(当前显示端, selectedDisplayIds)
    把 route 和 selectedDisplayIds 随文本媒体/playlistStart 下发并持久化

处理 textSentenceTts(origin, data):
    校验 playbackId/page/sentence/text
    校验 voiceTargetDisplayId 属于该播放上下文的 selectedDisplayIds
    生成或读取句子音频
    if route == origin:
        发送 textPlayback 音频给 origin
    else if route 在线且可语音播放:
        发送 textPlaybackRemote 音频给 route，附 originDisplayId
    else:
        回 origin 发送可定位 textSentenceTtsError

处理 textSentenceTtsFinished(target, data):
    校验 target、origin、playbackId 和句子定位
    将结束或失败消息转发给 origin
```

## 下一句预生成伪代码

```text
每个 originDisplayId 维护 playbackContext:
    playbackId
    selectedDisplayIds
    voiceTargetDisplayId
    activeSentence
    prefetchedSentence
    token

收到 textSentenceTts:
    if prefetch 且已有 prefetchedSentence:
        忽略重复请求
    串行执行 TTS 生成
    if token 仍有效:
        if prefetch:
            保存音频到 prefetchedSentence
            回源端 textSentenceTtsReady(prefetch=true)
        else:
            发送当前句音频

源显示端收到当前句音频:
    播放当前句
    若存在下一句:
        请求下一句并标记 prefetch=true

当前句 ended/remote finished:
    若 prefetchedAudio 已缓存:
        立即播放缓存句
    否则请求并等待下一句

pause/prev/next/stop/新 playbackId:
    令 token 失效
    清理源端和服务端的 prefetchedSentence
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
