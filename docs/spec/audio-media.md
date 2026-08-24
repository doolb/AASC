# 音频媒体播放实现伪代码

## 1. 类型识别与播放列表

```text
MediaLibraryProvider.detectMediaType(name):
    ext = name 去除查询串后转小写并取扩展名
    如果 ext 属于 gif: 返回 gif
    如果 ext 属于 mp4/webm/mov/avi/mkv: 返回 video
    如果 ext 属于 wav/ogg/mp3: 返回 audio
    如果 ext 属于 html/htm/mhtml: 返回 html
    否则返回 image

PlaylistManager.MEDIA_TYPES = image/video/gif/html/audio

buildFromLibrary(...):
    扫描文件夹
    只收集 MEDIA_TYPES 中的文件
    输出 url/fileName/mediaType

buildFromTemp(files):
    保留 data/fileName/mediaType/mimeType
```

## 2. 上传、媒体库与控制端

```text
Upload.detectMediaType(name):
    wav/ogg/mp3 → audio

Upload.getMediaDimensions(file, base64):
    如果 mediaType == audio: 返回 null
    否则沿用 video/image 尺寸探测

上传 input 与批量 input:
    accept 增加 audio/* 与 .wav/.ogg/.mp3

MediaLibrary.renderFileList(item):
    如果 item.mediaType == video: 使用 video 缩略图
    如果 item.mediaType == audio: 使用音频占位图标
    否则使用 image/HTML 既有分支

Crop.showPreview(url, audio):
    隐藏图片/视频预览
    显示 displayName；未提供时从 URL 提取当前文件名

MediaLibrary.updateCropPreview(info):
    批量 URL/临时缓存均把当前项 fileName 传给 Crop.showPreview

显示端/服务端/控制端当前文件名同步:
    显示端 playlistProgress 携带当前项 fileName/mediaType/url/尺寸
    服务端更新 displayState.currentPlaylist.index/state，并广播同一条进度
    控制端实时收到 playlistProgress → renderPlaylistPanel(info)
    控制端刷新收到 displayState.currentPlaylist:
        item = playlist[index]
        renderPlaylistPanel({ listId, index, total, state, ...item })
    临时播放列表只在服务端内存保留轻量预览元数据，不持久化 base64
```

## 3. 服务端 MIME 与 WebSocket

```text
server.detectMediaType(name):
    wav/ogg/mp3 → audio

mediaLibraryProxy:
    wav → audio/wav
    ogg → audio/ogg
    mp3 → audio/mpeg

displayTypes 注册 audioProgress
display 消息 audioProgress:
    更新 displayState.currentMediaProgress = {currentTime, duration}
    节流持久化 currentMediaProgress
    broadcastToControls({displayId, type, currentTime, duration})

control WebSocket:
    audioProgress 与 videoProgress 一样更新 progressSlider/progressValue
```

## 4. 显示端普通媒体

```text
DOM:
    mediaAudio = #mediaAudio

showMedia(data, noActivate, paused, resumeTime):
    如果 data.mediaType == audio:
        停止 html 滚动
        隐藏 image/video/html
        设置 mediaAudio.src 或 data URL
        mediaAudio.loop = true
        load()
        loadedmetadata 后将 currentTime 设置为 resumeTime（越界时夹取到有效范围）
        paused 时 pause，否则 playAudioAuto()
        绑定 timeupdate → audioProgress
    如果 data.mediaType == video:
        mediaVideo.loop = true          // 单媒体/重连恢复始终循环
        load()
        loadedmetadata 后将 currentTime 设置为 resumeTime（越界时夹取到有效范围）
        paused 时 pause，否则 playVideoAuto()
    否则沿用已有媒体分支

handleControl(play):
    根据当前媒体类型选择 mediaAudio/mediaVideo/html

handleControl(seek):
    根据当前媒体类型设置 audio/video.currentTime

handleControl(volume):
    根据当前媒体类型设置 audio/video.volume
```

## 5. 显示端批量播放

```text
stopPlaylist():
    移除 mediaVideo 与 mediaAudio 的 ended 监听
    清理 timer

playCurrentItem():
    若没有 active 或 paused 或 isSleepPaused(): 返回
    清理上一项 timer/ended 监听/error 回调
    showMedia(item, true)
    如果 item.mediaType == video:
        loop=false
        ended → timer = setTimeout(playlistNext, interval)
    如果 item.mediaType == audio:
        loop=false
        ended → timer = setTimeout(playlistNext, interval)
    否则:
        image/html 按既有间隔逻辑

playlistResume():
    audio 项若没有 timer/ended 监听则 play 并重新绑定 ended
```

## 6. 睡眠与控制端手动 next

```text
handlePlaylistControl(data):
    如果 data.action == next:
        activateTemporarily()       // 手动 next 是主动唤醒，进入 active
        playlistNext()               // 此时不受睡眠守卫拦截
    如果 data.action == pause/resume/prev/jump/stop:
        沿用既有处理

playlistNext():
    只由自动 timer/ended 进入时受 playCurrentItem 的 sleep 守卫拦截
    睡眠期间不推进 index，不排队自动 next
```
