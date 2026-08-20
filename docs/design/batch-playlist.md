# 批量播放模式设计文档

## 功能概述

控制端媒体库支持文件夹级别批量播放：选择文件夹后弹出模式设置框（扫描范围、间隔时间、播放模式、排序方式、方向、循环播放、播报文件名），服务端扫描文件夹生成完整播放列表一次性下发给显示端，显示端本地自循环播放（图片按间隔、视频播完+间隔，支持列表循环），并上报播放进度、接受控制端干预（暂停/继续/上一个/下一个/停止）。临时模式（base64 中转不落盘）同样支持批量：在显示控制面板的画面裁剪区域多选文件，弹出同一模式设置框，控制端一次性上传文件 base64，服务端生成列表下发。批量播放可被单文件播放打断。

## 已确认的设计决策

| 决策点 | 结论 |
|--------|------|
| 列表生成位置 | 服务端（PlaylistManager），控制端只发请求参数与临时文件数据 |
| 播放节奏控制 | 混合：列表一次性下发，显示端本地自循环，同时上报进度供控制端查看/干预 |
| 随机语义 | 洗牌后顺序播一遍（Fisher-Yates），每项只播一次 |
| 间隔语义 | 图片固定展示间隔；视频播放自身时长，播完后再等间隔 |
| 循环 | 默认开启，播完最后一项回绕到第 0 项 |
| 排序 | 默认按文件名；可选按时间；支持正序/反序；随机模式忽略排序 |
| 播报文件名 | 默认关闭；批量期间覆盖 autoTtsEnabled，结束后恢复 |
| 打断 | 任何单媒体消息/新列表到达时停止当前批量循环（幂等） |
| 临时模式传输 | 控制端全部转 base64 一次性 playlistRequest，服务端组列表后一次性下发 |
| 重连恢复 | 非临时列表持久化到 config，重连补发 playlistStart + resumeIndex 断点续播 |
| 临时批量上限 | base64 总量 350MB（预留膨胀，WS maxPayload 500MB） |

## 架构

```
控制端 (upload.html)
  ① 媒体库文件夹：playlistRequest {libraryId, path, recursive, interval, mode, sortBy, direction, loop, announceName, displayIds}
  ② 临时模式多选：playlistRequest {files:[{name, base64, mediaType, mimeType, modifiedTime}...], interval, mode, sortBy, direction, loop, announceName, displayIds, temp:true}
      ▼
服务端 (server-app.js + PlaylistManager)
  ① 扫描文件夹（递归/单层）→ 过滤媒体 → 排序/洗牌 → [{url, fileName, mediaType}]
  ② 接收 base64 数组 → 排序/洗牌 → [{data, fileName, mediaType, mimeType}]
  → 持久化 currentPlaylist（仅非临时）→ playlistStart 一次性下发
      ▼
显示端 (display.html)
  本地自循环：图片间隔计时器 / 视频 ended+间隔；循环回绕
  → playlistProgress 上报 → 接受 playlistControl 干预
```

## 消息协议

### playlistRequest（控制端 → 服务端）
```json
{ "type": "playlistRequest", "libraryId": "local_uploads", "path": "/相册",
  "recursive": true, "interval": 5, "mode": "sequence",
  "sortBy": "name", "direction": "asc", "loop": true, "announceName": false,
  "displayIds": ["display-xxx"] }
```
临时模式：`"temp": true` + `"files": [{name, data(base64), mediaType, mimeType, modifiedTime}]`

### playlistStart（服务端 → 显示端）
```json
{ "type": "playlistStart", "listId": "pl-xxxx",
  "playlist": [{ "url": "...", "fileName": "a.jpg", "mediaType": "image" }],
  "interval": 5, "loop": true, "announceName": false, "temp": false,
  "resumeIndex": 0 }
```
`resumeIndex` 仅重连恢复时携带。

### playlistProgress（显示端 → 服务端 → 控制端）
```json
{ "type": "playlistProgress", "displayId": "display-xxx",
  "listId": "pl-xxxx", "index": 3, "total": 20,
  "state": "playing|paused|finished|stopped", "fileName": "a.jpg" }
```

### playlistControl（控制端 → 服务端 → 显示端）
```json
{ "type": "playlistControl", "displayIds": ["display-xxx"],
  "action": "pause|resume|next|prev|stop|jump", "index": 5 }
```

### 响应（服务端 → 控制端）
- `playlistStarted`：{listId, total, displayIds}
- `playlistError`：{message}

## 音频与睡眠手动切换补充

- `audio` 与 image/video/gif/html 一样纳入播放列表；音频自然结束后等待 interval 再切换。
- 自动定时器或媒体 ended 回调在睡眠态触达 `playCurrentItem()` 时继续拦截，不推进索引、不排队。
- 控制端手动发送 `playlistControl(next)` 时，显示端先 `activateTemporarily()` 进入 60 秒 active，再执行 `playlistNext()`。
- 显示端实时回传当前 `fileName`；控制端刷新后从 `displayState.currentPlaylist` 恢复当前项，临时批量只保留轻量元数据并显示文件名占位。

## 打断规则

- 服务端：mediaBatch/media 发送单媒体前清除目标显示端 currentPlaylist（config 同步）
- 显示端：收到单媒体消息（else 分支）先 stopPlaylist() 再 showMedia
- playlistControl 在列表已被打断后无效（playlistState 为 null 直接忽略）

## 相关文件

| 文件 | 说明 |
|------|------|
| src/apps/web-mediacenter/modules/media/playlist-app-service.js | PlaylistManager 列表生成/排序/洗牌 |
| src/apps/server/boot/server-app.js | playlistRequest/Control/Progress 处理、持久化、重连恢复、打断 |
| src/apps/web-mediacenter/ui/public/display.html | 显示端批量播放循环 |
| src/apps/web-mediacenter/ui/public/js/websocket.js | sendPlaylistRequest/Control、进度消息处理 |
| src/apps/web-mediacenter/ui/public/js/media-library.js | 文件夹批量按钮、模式设置框、进度面板 |
| src/apps/web-mediacenter/ui/public/js/upload.js | 裁剪区多文件/文件夹批量上传 |
| src/apps/web-mediacenter/ui/public/css/upload.css | 设置框与进度面板样式 |
| tests/playlist-app-service.test.js | PlaylistManager 单元测试 |
