# 音频媒体播放设计

## 需求

普通媒体链路新增 WAV、OGG、MP3 音频播放能力。音频需要可以从控制端本地上传、临时发送、媒体库播放和批量播放，并通过服务器转发到显示端。

## 媒体类型

- `.wav` → `audio`，MIME 使用 `audio/wav`
- `.ogg` → `audio`，MIME 使用 `audio/ogg`
- `.mp3` → `audio`，MIME 使用 `audio/mpeg`

音频作为独立 `audio` 媒体类型处理，不复用 `video` 分支。显示端使用独立的 `#mediaAudio` 元素，控制端沿用播放/暂停、进度和音量控制。

## 数据流

```text
控制端上传/媒体库点击
  → mediaType=audio
  → server media/mediaBatch/playlistRequest
  → media library 或 data URL
  → 显示端 #mediaAudio
  → audioProgress → server → control
```

服务器媒体库代理按扩展名返回音频 MIME，并在 ViewBind 消息注册表与回退处理器中转发 `audioProgress`。

## 当前文件名同步

- 显示端批量播放每次发送 `playlistProgress` 时携带当前项 `fileName`、`mediaType` 和 URL/尺寸元数据。
- 控制端实时收到进度后更新批量面板和裁剪预览；页面刷新后通过 `displayState.currentPlaylist` 恢复当前项文件名。
- 临时批量不保存音频 base64，仅在服务端内存保留文件名、媒体类型和预览元数据；控制端刷新后显示带文件名的不可预览占位。

## 单媒体行为

- URL 媒体通过服务器统一出口下发，临时文件携带 `mimeType` 与 base64 数据。
- 显示端隐藏图片、视频和 HTML，加载 `#mediaAudio` 并自动播放；单媒体沿用视频的循环播放语义。
- 播放/暂停、seek、音量控制根据当前媒体类型选择音频或视频元素。
- 控制端收到 `audioProgress` 后更新同一个进度条；发送 seek 时使用统一 `seek` 控制命令。
- 裁剪预览不尝试把音频当图片解码，显示当前音频文件名占位提示；批量播放优先使用进度消息携带的 `fileName`。

## 批量行为

- 媒体库扫描和临时批量上传均把 `audio` 纳入可播放类型。
- 音频项使用 `#mediaAudio`，设置 `loop=false`，监听 `ended`；自然结束后等待配置间隔，再进入下一项。
- 音频加载失败后沿用视频/图片的容错策略，等待间隔后切换下一项。
- 批量播放暂停时移除 ended 监听、暂停音频并清理定时器；恢复时续播当前项或重新计时。

## 睡眠模式与手动 next

- 自动定时器、媒体 ended 回调在睡眠/深度睡眠时继续由 `playCurrentItem()` 拦截，不推进批量索引，也不排队自动 next。
- 控制端手动点击“下一个”是用户主动唤醒操作：显示端收到 `playlistControl(next)` 后先调用 `activateTemporarily()`，进入 60 秒 `active` 状态，再执行 `playlistNext()`。
- 手动 next 不应被睡眠守卫吞掉；临时激活会清除手动睡眠覆盖，保持现有临时激活优先级。

## 兼容性

- image/video/gif/html 的识别、播放、批量切换和进度逻辑保持原行为。
- 旧状态缺少 `audio` 时按现有媒体类型恢复，不改变已有持久化字段结构。
