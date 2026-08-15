# 批量播放模式实现文档

## 概述

批量播放模式实现"文件夹级播放列表 + 显示端本地自循环"：服务端生成完整播放列表一次性下发，显示端按序播放（图片按间隔、视频播完+间隔、支持循环），上报进度并接受控制端干预。临时模式通过 base64 中转同样支持批量。

## 1. PlaylistManager 模块

### playlist-app-service.js

```
常量 MEDIA_TYPES = ['image', 'video', 'gif', 'html']

类 PlaylistManager:
    属性:
        manager: 媒体库管理器（注入）

    方法:
        _sortPlaylist(items, mode, sortBy, direction):
            如果 mode === 'random':
                返回 _shuffle(items)
            dir = direction === 'desc' ? -1 : 1
            返回 items 排序:
                如果 sortBy === 'time':
                    cmp = modifiedTime 差值
                否则:
                    cmp = name.localeCompare
                返回 cmp * dir

        _shuffle(arr):
            Fisher-Yates 洗牌，返回新数组

        async buildFromLibrary(libraryId, path, {recursive, mode, sortBy, direction}):
            all = []
            queue = [path]
            循环直到 queue 空:
                dir = queue.shift()
                items = await manager.list(libraryId, dir)
                遍历 items:
                    如果 type === 'folder':
                        如果 recursive: queue.push(item.path)
                    否则如果 mediaType ∈ MEDIA_TYPES:
                        all.push(item)
            sorted = _sortPlaylist(all, ...)
            返回 sorted 映射为 {url, fileName: name, mediaType}

        buildFromTemp(files, {mode, sortBy, direction}):
            sorted = _sortPlaylist(files, ...)
            返回 sorted 映射为 {data, fileName: name, mediaType, mimeType}
```

## 2. 服务端消息处理 (server-app.js)

### 初始化

```
const { PlaylistManager } = require('../../web-mediacenter/modules/media/playlist-app-service');
const playlistManager = new PlaylistManager(mediaLibraryManager);
```

### playlistRequest（控制端 → 服务端）

```
处理 'playlistRequest':
    异步执行:
        displayIds = data.displayIds
        如果空: 回复 playlistError '没有可用的显示端'
        如果 data.temp:
            playlist = playlistManager.buildFromTemp(data.files, {mode, sortBy, direction})
        否则:
            playlist = await playlistManager.buildFromLibrary(libraryId, path, {recursive, mode, sortBy, direction})
        如果 playlist 空: 回复 playlistError '没有可播放的媒体文件'
        listId = 'pl-' + 时间戳 + 随机
        startData = {listId, playlist, interval, loop, announceName}
        遍历 displayIds:
            dd = displayClients.get(id)
            如果 dd 存在:
                如果非 temp:
                    dd.state.currentPlaylist = {startData, index: 0, state: 'playing'}
                    config.updateDisplayState(ip, {currentPlaylist})
                sendToDisplay(id, {type: 'playlistStart', ...startData, temp})
        ws.send(playlistStarted)
    异常: logError + 回复 playlistError
```

### playlistControl（控制端 → 服务端 → 显示端）

```
处理 'playlistControl':
    遍历 displayIds:
        sendToDisplay(id, {type: 'playlistControl', action, index})
        如果 action === 'stop' 且 dd.state.currentPlaylist:
            dd.state.currentPlaylist = null
            config.updateDisplayState(ip, {currentPlaylist: null})
```

### playlistProgress（显示端 → 服务端）

```
处理 'playlistProgress':
    如果 displayData.state.currentPlaylist:
        更新 index/state
        如果 state ∈ {finished, stopped}:
            currentPlaylist = null，config 同步清除
        否则:
            config.updateDisplayState(ip, {currentPlaylist})
    broadcastToControls({displayId, type:'playlistProgress', listId, index, total, state,
        fileName, url, mediaType, width, height})
    说明: url/mediaType 供控制端裁剪预览区跟随；width/height 为显示端实际播放
          尺寸（临时模式控制端无数据时依赖此尺寸），媒体加载完成后
          loadedmetadata/load 补报一次带尺寸进度，暂停期间补报保持 paused
```

### 单媒体打断

```
mediaBatch / media 分支发送前:
    如果 dd.state.currentPlaylist:
        dd.state.currentPlaylist = null
        config.updateDisplayState(ip, {currentPlaylist: null})
```

### 重连恢复

```
显示端重连时:
    如果 savedState.currentPlaylist:
        ws.send(playlistStart, ...startData, resumeIndex: currentPlaylist.index)
    否则如果 savedState.currentMedia:
        ws.send(restoreState)
```

## 3. 显示端批量播放循环 (display.html)

### 状态

```
playlistState = null   // {listId, playlist, interval(ms), loop, index, timer, videoEndedHandler, active}
savedAutoTts = null    // 原始 autoTtsEnabled 备份
```

### 函数

```
stopPlaylist():
    如果 playlistState 为空: 返回（幂等）
    active = false
    清除 timer
    移除 video ended 监听
    如果 savedAutoTts 非空: autoTtsEnabled = savedAutoTts
    playlistState = null

handlePlaylistStart(data):
    stopPlaylist()
    savedAutoTts = autoTtsEnabled
    autoTtsEnabled = data.announceName
    如果 playlist 空: stopPlaylist 返回
    resumeIndex = 夹取到 [0, len-1]
    playlistState = {...}
    playCurrentItem()

playCurrentItem():
    如果非 active: 返回
    item = playlist[index]
    构建 mediaData (url 或 base64 类型)
    showMedia(mediaData)

showMedia 的 html 媒体分支（display.html）:
    隐藏 img/video，显示 iframe#mediaHtml（铺满、pointer-events:none）
    旋转适配: transform 跟随 rotate(); 90/270° 时宽高互换（100vh × 100vw）并
        top/left 保持 0（清除会让元素回到 flex 静态位置）+ 
        translate(50vw,50vh) translate(-50%,-50%) rotate(deg) 先旋转后平移到视口中心
    非 html 媒体分支: stopHtmlScroll + 隐藏 iframe（清空 src/srcdoc），html 切回图片/视频时清理
    mediaType === 'html':
        url 且扩展名 .mhtml:
            // Chromium 无法直接渲染 mhtml（导航 ERR_ABORTED），需转换
            fetch(url) -> mhtmlToHtml() -> iframe.srcdoc = 转换后 HTML
        url 其他: iframe.src = url
        base64: 解码 -> iframe.srcdoc
    onload -> startHtmlScroll(iframe, htmlScroll)（分页/平滑 + 循环开关）
    temp 上报不含宽高

startHtmlScroll(iframe, htmlScroll):
    opts = htmlScroll || {}; mode = opts.mode === 'loop' ? 'smooth' : (opts.mode || 'page')
    loop = opts.loop || opts.mode === 'loop'   // 兼容旧消息
    内容不溢出（scrollHeight <= clientHeight）: 不滚动
    mode === 'page': 每 pageInterval 秒 scrollBy(0, 视口高); 到底时 loop ? 回顶继续 : 停止
    mode === 'smooth': rAF 匀速 scrollBy; 到底时 loop ? 回顶继续 : 停止

mhtmlToHtml(text):
    解析 multipart/related boundary
    各 part:
        content-type text/html -> 主文档（base64/quoted-printable 解码，charset 支持 utf-8/gbk）
        其他 part（Content-Location/Content-ID）-> 资源表:
            解码后转 base64 data URI
    主文档引用重写: src/href/url() 与资源表匹配（支持 cid: 前缀）-> data: URI
    如果 mediaType === 'video':
        mediaVideo.loop = false
        添加一次性 ended 监听: 移除监听 -> timer = setTimeout(next, interval)
        设置 onerror: 加载失败 -> 等间隔后 next
    否则:
        mediaImage.onerror: 加载失败 -> 等间隔后 next
        timer = setTimeout(next, interval)
    发送 progress(playing)

playlistNext():
    如果非 active: 返回
    如果 index+1 >= length:
        如果 loop: index = 0, playCurrentItem()
        否则: finishPlaylist()
    否则: index++, playCurrentItem()

playlistPrev():
    index = index-1 < 0 ? (loop ? length-1 : 0) : index-1
    playCurrentItem()

playlistJump(index):
    越界返回
    index 赋值, playCurrentItem()

playlistPause():
    清除 timer
    如果 videoEndedHandler 存在: 移除监听 + mediaVideo.pause()
    发送 progress(paused)

playlistResume():
    如果视频正在播放状态 (timer/handler 均空): mediaVideo.play + 重建 ended 监听
    否则: timer = setTimeout(next, interval)   // 图片或间隔等待
    发送 progress(playing)

finishPlaylist():
    记录 info
    清理 timer/ended 监听/恢复 autoTtsEnabled
    playlistState = null
    发送 progress(finished)

handlePlaylistControl(data):
    如果 playlistState 为空: 返回
    switch action:
        pause -> playlistPause
        resume -> playlistResume
        next -> playlistNext
        prev -> playlistPrev
        jump -> playlistJump(data.index)
        stop -> 记录 info, stopPlaylist(), 发送 progress(stopped)
```

### 消息接入

```
WS onmessage:
    'playlistStart' -> handlePlaylistStart + ack
    'playlistControl' -> handlePlaylistControl + ack
    else（单媒体）-> stopPlaylist() + showMedia(data) + ack
```

## 4. 控制端 (websocket.js / media-library.js / upload.js)

### websocket.js

```
sendPlaylistRequest(payload):
    displayIds = DisplayList.getSelectedDisplayIds()
    如果空: toast 提示，返回 false
    发送 {type: 'playlistRequest', ...payload, displayIds}
    返回 true

sendPlaylistControl(displayIds, action, index):
    发送 {type: 'playlistControl', displayIds, action, index}

handleMessage:
    'playlistProgress' -> MediaLibrary.renderPlaylistPanel(data)
        renderPlaylistPanel 内同步: 媒体库面板/显示控制界面/快捷面板 + updateCropPreview
        updateCropPreview:
            媒体库模式（有 url）: Crop.showPreview(url, mediaType)
            临时模式: 优先用控制端缓存 base64（tempPlaylistFiles[index]）dataURL 预览
            控制端刷新缓存丢失: 显示占位提示（第 x/y 项 · 文件名 · 显示端回传宽x高）
            去重: _lastCropPreviewUrl 相同则不更新
    'playlistError' -> toast 错误
    'playlistStarted' -> toast 已发送
```

### media-library.js

```
showPlaylistSettingsDialog({title, hideRecursive, onConfirm}):
    创建模态框:
        扫描范围 radio（hideRecursive 时隐藏）
        间隔时间 number（默认 5）
        播放模式 radio: 顺序/随机（默认顺序）
        排序方式 radio: 按文件名（默认）/按时间
        播放方向 radio: 正序/反序
        循环播放 checkbox（默认勾选）
        播报文件名 checkbox（默认不勾选）
    随机模式选中时排序/方向行置灰禁用
    确认 -> 收集 settings 传给 onConfirm

showBatchPlayDialog(folderPath):
    显示设置框
    确认 -> sendPlaylistRequest({libraryId, path: folderPath, ...settings})

入口（upload.html）:
    - 文件夹项右侧「批量播放」按钮 -> showBatchPlayDialog(item.path)
    - 工具栏「批量播放当前文件夹」按钮 -> showBatchPlayDialog(MediaLibrary.currentPath)（支持根目录）

ensurePlaylistPanel():
    动态创建媒体库进度面板（无则建）
    （插入到 mediaLibraryContent 之前）

renderPlaylistPanel(info):
    同步更新三处:
        renderMediaLibraryPanel: 媒体库进度面板（动态创建）
        renderDisplayControlPanel: 显示控制界面 #displayPlaylistStatus
        renderFloatingControlPanel: 快捷控制面板 #floatingPlaylistStatus
    每处: stopped/finished -> 隐藏
    否则显示: "第 x/y 项 · 文件名 · 播放中/已暂停"
    切换暂停/继续按钮文案（dataset.action 记录 pause/resume）

controlPlaylist(action, btn):
    toggle -> 根据按钮 dataset.action 转 pause/resume
    sendPlaylistControl(displayIds, action)
```

### upload.js（临时模式批量）

```
handleDroppedFiles(dataTransfer):
    entries = webkitGetAsEntry 列表
    如果含目录: 递归收集所有文件（collectDir/collectFile）
    否则: 收集 dataTransfer.files
    单文件 -> sendTempFile（原有）
    多文件 -> showBatchTempUpload

prepareTempFiles(files):
    总大小 > 350MB -> toast 提示，返回 null
    逐文件: fileToBase64 + getMediaDimensions
    返回 [{name, data, mediaType, mimeType, modifiedTime, width, height}]

showBatchTempUpload(files):
    MediaLibrary.showPlaylistSettingsDialog({hideRecursive: true})
    确认 -> sendPlaylistRequest({temp: true, files: items, ...settings})
```

## 5. 持久化结构

```
config 中每显示端状态:
    currentPlaylist: {
        startData: {listId, playlist, interval, loop, announceName},
        index: 当前索引,
        state: 'playing' | 'paused'
    }
    仅非临时列表持久化；临时列表随连接消失
```
