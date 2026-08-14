# 批量播放模式设计文档

日期：2026-08-14

## 功能概述

控制端媒体库支持文件夹级别批量播放：选择文件夹后弹出模式设置框（扫描范围、间隔时间、播放模式、排序方式、方向、播报文件名），服务端扫描文件夹生成完整播放列表一次性下发给显示端，显示端本地自循环播放（图片按间隔、视频播完+间隔），并上报播放进度、接受控制端干预（暂停/继续/上一个/下一个/停止）。临时模式（base64 中转不落盘）同样支持批量：在显示控制面板的画面裁剪区域多选文件，弹出同一模式设置框，控制端一次性上传文件 base64，服务端生成列表下发。批量播放可被单文件播放打断。

## 架构与数据流

```
控制端 (upload.html)
  批量播放请求（两个来源，统一 playlistRequest 消息）：
  ① 媒体库文件夹：{libraryId, path, recursive, interval, mode, sortBy, direction, displayIds}
  ② 临时模式多选：{files:[{name, base64, mediaType, width, height}...], interval, mode, sortBy, direction, displayIds, temp:true}
      ▼
服务端 (server-app.js + PlaylistManager)
  ① 媒体库：扫描文件夹（递归/单层）→ 过滤媒体 → 排序/洗牌 → 列表项 {url,...}
  ② 临时：接收 base64 数组 → 排序/洗牌 → 列表项 {data: base64,...}
  → 持久化 currentPlaylist（仅非临时）
  → 一次性发送 playlistStart 到目标显示端
      ▼
显示端 (display.html)
  接收完整列表（非临时只存 URL 引用按需加载；临时缓存 base64 数据）
  → 本地自循环播放：图片用间隔计时器、视频用 ended 事件+间隔
  → 上报 playlistProgress（索引、总数、状态）
  → 接收干预指令（暂停/继续/上一个/下一个/停止）
```

原则：服务端是唯一列表生成者；控制端只发请求参数与临时文件数据；显示端只负责按序播放、回传进度、接受干预。

## 消息协议

### 1. playlistRequest（控制端 → 服务端）

媒体库来源：
```json
{ "type": "playlistRequest", "libraryId": "local_uploads", "path": "/相册",
  "recursive": true, "interval": 5, "mode": "sequence",
  "sortBy": "time", "direction": "desc", "announceName": false,
  "displayIds": ["display-xxx"] }
```

临时模式来源（多选文件，base64 内嵌）：
```json
{ "type": "playlistRequest", "temp": true,
  "files": [{ "name": "a.jpg", "base64": "...", "mediaType": "image", "width": 1920, "height": 1080 }],
  "interval": 5, "mode": "random", "announceName": false,
  "displayIds": ["display-xxx"] }
```

### 2. playlistStart（服务端 → 显示端）

服务端已完成排序/洗牌，列表按最终顺序下发：
```json
{ "type": "playlistStart", "listId": "pl-xxxx",
  "playlist": [{ "url": "http://.../uploads/xxx.jpg", "fileName": "a.jpg", "mediaType": "image" }],
  "interval": 5, "announceName": false, "temp": false }
```
临时模式 `temp:true`，列表项含 `data`（base64）而非 `url`。

### 3. playlistProgress（显示端 → 服务端 → 转发控制端）

```json
{ "type": "playlistProgress", "displayId": "display-xxx",
  "listId": "pl-xxxx", "index": 3, "total": 20,
  "state": "playing|paused|finished|stopped", "fileName": "a.jpg" }
```

### 4. playlistControl（控制端 → 服务端 → 转发显示端）

```json
{ "type": "playlistControl", "displayIds": ["display-xxx"],
  "action": "pause|resume|next|prev|stop|jump", "index": 5 }
```

## 服务端实现

### 播放列表生成模块（新增 src/apps/web-mediacenter/modules/media/playlist-app-service.js）

```
对象 PlaylistManager:
    init() -> 加载持久化的播放列表状态

    buildFromLibrary(libraryId, path, {recursive, mode, sortBy, direction}) -> playlist
        调用 mediaLibraryManager.list(libraryId, path)
        过滤 mediaType 为 image/video/gif 的文件
        如果 recursive:
            广度优先递归列出所有子文件夹（复用 provider.list）
        收集所有媒体文件
        排序:
            mode === 'random' -> Fisher-Yates 洗牌（忽略 sortBy/direction）
            sortBy === 'time' -> 按 modifiedTime 排序（asc/desc）
            sortBy === 'name' -> 按 fileName localeCompare 排序（asc/desc）
        映射为列表项: {url: provider.getPublicUrl, fileName, mediaType}
        返回 playlist

    buildFromTemp(files, {mode, sortBy, direction}) -> playlist
        直接接收控制端传来的文件数组（name/base64/mediaType/width/height）
        排序/洗牌逻辑同上
        映射为列表项: {data: base64, fileName, mediaType, width, height}
        返回 playlist

    savePlaylist(displayId, playlistData) -> 持久化（仅非临时）
    loadPlaylist(displayId) -> 重连恢复
    clearPlaylist(displayId) -> 停止/打断/播完时清除
```

### 服务端 WS 消息处理（server-app.js 新增分支）

```
'playlistRequest' 处理:
    目标显示端 = data.displayIds（沿用现有选择模式）
    如果 data.temp:
        playlist = PlaylistManager.buildFromTemp(data.files, 模式参数)
        不持久化
    否则:
        校验 libraryId/path 有效，列表非空
        playlist = PlaylistManager.buildFromLibrary(...)
        持久化 currentPlaylist 到 config（每个目标显示端）
    listId = 时间戳+随机数生成唯一ID
    对每个显示端:
        sendToDisplay(id, {type:'playlistStart', listId, playlist, interval, announceName, temp})

'playlistControl' 处理:
    对每个 displayIds:
        sendToDisplay(id, {type:'playlistControl', action, index})
    action 为 stop 时清除该显示端的 currentPlaylist 持久化

'playlistProgress' 处理:
    更新对应显示端的 currentPlaylist.index/state（用于控制端 UI 与重连恢复）
    转发给所有控制端

普通单媒体发送（mediaBatch/media）:
    发送前清除目标显示端的 currentPlaylist 持久化（单文件打断批量）
```

### 排序细节

- `mode: 'random'` → Fisher-Yates 洗牌，忽略 sortBy/direction
- `mode: 'sequence'` + `sortBy: 'time'` → 按 `modifiedTime` 升/降序
- `mode: 'sequence'` + `sortBy: 'name'` → 按文件名 localeCompare 升/降序
- 递归扫描时先收集全部文件再统一排序（文件夹内文件先于子文件夹收集，不影响最终排序）

## 显示端实现（display.html 新增批量播放模块）

### 批量播放循环状态

```
状态:
    playlistState = { listId, playlist: [], index: -1, timer: null, videoEndedHandler: null, active: false }
    保存原始 autoTtsEnabled

接收 'playlistStart':
    stopPlaylist()                        // 打断任何现有播放
    playlistState = { listId, playlist: data.playlist, index: 0, active: true }
    autoTtsEnabled = data.announceName     // 覆盖播报开关
    发送 progress (index=0, playing)
    playCurrentItem()
```

### 播放控制

```
playCurrentItem():
    item = playlist[index]
    构建媒体数据 {type: 'url'|'base64', url|data, fileName, mediaType, width, height}
    showMedia(mediaData)                  // 复用现有渲染函数
    如果 item 是图片/gif:
        timer = setTimeout(间隔后 -> next(), interval * 1000)
    如果 item 是视频:
        mediaVideo.loop = false            // 确保播完触发 ended
        添加一次性的 'ended' 监听:
            移除监听
            setTimeout(间隔后 -> next(), interval * 1000)   // 视频播完+间隔
    发送 progress (index, playing)

next() / prev() / jump(index):
    index 增减/跳转，越界处理（超出末尾 -> finish）
    发送 progress (index, playing)

finish():
    active = false
    恢复 autoTtsEnabled 原值
    发送 progress (state: finished)
    （屏幕停留在最后一项，等待下一次播放指令）

stopPlaylist():
    active = false
    清除 timer
    移除视频 ended 监听
    恢复 autoTtsEnabled 原值
    （幂等：无活动循环时调用无害）
```

### 干预指令处理（'playlistControl'）

```
pause:   清除 timer / 暂停视频, 发送 progress(paused)
resume:  图片重新计时 / 视频 play(), 发送 progress(playing)
next/prev/jump: 按 action 调整 index 后 playCurrentItem()
stop:    stopPlaylist(), 发送 progress(stopped)
```

### 打断规则

- 显示端收到任何单个媒体消息（现有 mediaBatch 单文件）或新的 playlistStart 时，先 stopPlaylist() 再处理新内容
- 批量播放中列表已被打断后，playlistControl 无效（可忽略或返回 stopped 进度）
- 现有入口（showMedia、handleControl 的 play/seek/volume 等）不动，仅批量循环在收到新媒体消息时先停止自己

### 播报文件名

- 批量播放期间用列表携带的 announceName 覆盖 autoTtsEnabled
- 列表结束/停止/打断时恢复原始 autoTtsEnabled 值
- 复用现有 showMedia 内的 TTS 播报逻辑

## 控制端 UI 实现（upload.html / media-library.js / upload.js）

### 1. 媒体库文件夹入口

- 文件列表的文件夹项上新增「批量播放」按钮，点击弹出模式设置框
- 文件项仍走原有单文件播放
- 模式设置框确认后发 playlistRequest，沿用现有显示端选择模式（单选/全选/自适应）

### 2. 模式设置框（模态框，媒体库与临时模式共用）

```
┌─ 批量播放设置 ──────────────────────┐
│  扫描范围: (•) 当前文件夹  ( ) 递归子文件夹   │
│  间隔时间: [ 5 ] 秒                        │
│  播放模式: (•) 顺序  ( ) 随机              │
│  排序方式: (•) 按文件名  ( ) 按时间  [仅顺序] │
│  播放方向: (•) 正序  ( ) 反序              │
│  播报文件名: [ ] 默认关闭                    │
│                [取消]  [开始播放]            │
└────────────────────────────────────────┘
```

- 排序方式默认「按文件名」
- 随机模式下排序方式/方向置灰（洗牌忽略排序参数）

### 3. 批量播放进度与干预面板

- 媒体库区域顶部（或浮动条）显示当前批量播放状态：`第 3/20 张 · a.jpg · 播放中`，随 playlistProgress 更新
- 干预按钮：暂停/继续、上一个、下一个、停止
- 多个显示端批量播放时，面板显示所选显示端的进度
- 单文件播放打断批量后进度面板消失

### 4. 临时模式批量上传

- 入口在显示控制面板的画面裁剪区域（#cropPreviewContainer，现有拖拽/粘贴上传位置）
- 支持多文件拖拽/多选，或文件夹选择（webkitdirectory 天然递归收集全部文件）
- 模式设置框中「扫描范围」选项在临时模式下隐藏（文件夹选择天然递归，多文件选择无层级）
- 选完弹出同一个模式设置框
- 确认后：所有文件校验 ≤ 上限 → 逐个转 base64 → 一次性 playlistRequest {temp:true, files:[...]} → 服务端生成列表 → 下发显示端
- base64 总大小超 WS maxPayload（500MB）时控制端提示错误并中止

## 错误处理与边界

1. **空列表**：扫描结果无媒体文件 → 服务端提示错误，不发 playlistStart
2. **递归扫描异常**：单个子文件夹读取失败（权限/连接断开）→ 跳过该文件夹并记录日志，不中断整体
3. **媒体加载失败**：显示端某文件加载失败（404/断网）→ 跳过该项，等间隔后播下一个，不卡死循环
4. **临时模式超限**：base64 总大小超 maxPayload → 控制端校验并提示中止
5. **显示端重连**：非临时列表持久化 → 重连后服务端补发 playlistStart + 当前索引进度，断点续播；临时列表重连丢失（与现有临时媒体行为一致）
6. **显示端离线**：发送列表时目标已离线 → 服务端跳过，进度面板提示无显示端
7. **打断幂等**：stopPlaylist() 无活动循环时调用无害

## 测试计划

1. 媒体库文件夹批量播放：递归/单层各测，图片间隔切换、视频播完+间隔
2. 顺序+按文件名正/反序、按时间正/反序，验证列表顺序
3. 随机模式洗牌：列表不重复、顺序随机
4. 播报文件名开关：开→每项 TTS 播报；关→不播报；结束后恢复原 autoTtsEnabled
5. 干预：暂停/继续/上一个/下一个/停止，视频暂停可恢复
6. 打断：批量播放中发送单文件 → 批量停止、单文件正常播放
7. 空文件夹：提示无媒体
8. 临时模式多选：裁剪区拖入多文件 → 弹设置框 → 播放正常
9. 重连恢复：非临时列表播放中断线重连 → 从断点续播
10. 兼容性：现有单文件播放、视频进度条、裁剪功能不回归

## 影响的功能模块

| 模块 | 文件 | 改动 |
|------|------|------|
| 服务端 | src/apps/server/boot/server-app.js | playlistRequest/playlistControl/playlistProgress 消息处理、单媒体发送时清列表 |
| 新增 | src/apps/web-mediacenter/modules/media/playlist-app-service.js | PlaylistManager 列表生成/持久化 |
| 显示端 | src/apps/web-mediacenter/ui/public/display.html | 批量播放循环、进度上报、干预处理、打断 |
| 控制端 | src/apps/web-mediacenter/ui/public/js/media-library.js | 文件夹批量播放入口、模式设置框、进度面板 |
| 控制端 | src/apps/web-mediacenter/ui/public/js/upload.js | 裁剪区多选临时文件、批量 base64 上传 |
| 控制端 | src/apps/web-mediacenter/ui/public/js/websocket.js | playlistRequest/playlistControl 发送封装 |
| 样式 | src/apps/web-mediacenter/ui/public/css/upload.css | 模式设置框、进度面板样式 |
