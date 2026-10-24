# 显示端未知 WebSocket 消息保护媒体恢复

## 任务描述

修复 Android/WebView 在收到重连恢复媒体后，继续收到配置消息时媒体源被清除的问题。原因是显示端 WebSocket 未识别类型默认落入 `showMedia(data)`，将配置消息误作媒体。

## Design 需求

- 只有 `url`、`base64` 两种明确的媒体消息可以进入 `showMedia`。
- 未知消息忽略或记录，不停止播放列表、不移除媒体源、不发送媒体命令确认。
- restoreState 后紧跟连接配置消息时，单媒体与播放列表恢复状态保持不变。

## Spec 设计

- 更新 `docs/spec/websocket.md` 中显示端收包伪代码。
- 已知协议类型继续由既有分支处理；默认分支仅识别 URL/Base64 媒体。
- 未知类型不执行媒体副作用。

## 受影响功能与代码

- `src/apps/web-mediacenter/ui/public/display.html`
- `tests/display-message-dispatch.test.js`
- `docs/design/display.md`、`docs/spec/websocket.md`
- `docs/spec/self-test.md`、`docs/todo.md`、`changelog.md`

## 自测用例

- 恢复视频后依次收到 `ttsProviderConfig`、`chatModelTierConfig`，视频元素的 URL、媒体类型和播放意图不变。
- 未知消息不会调用 `showMedia`、`stopPlaylist` 或发出 media ack。
- `url`、`base64` 仍正常进入媒体处理分支并回执。
- 在当前 Note8 WebView 上观察服务端自动重连后的恢复帧和视频加载状态。

## 兼容性测试

- 服务端现有 `url`、`base64`、`restoreState`、`playlistStart` 和配置消息格式保持不变。
- 浏览器和 Android WebView 共用同一页面分发逻辑；Node 子显示端不受影响。

## 性能测试

- 未知消息只进行一次类型判断，不新增媒体请求或网络往返。
- 恢复媒体和常规消息处理不增加定时器或常驻状态。

## 风险评估

- 若历史客户端使用了除 `url`、`base64` 外的未登记媒体类型，该类型将被忽略；已核对服务端单媒体与批量播放入口均发送 `url`，内嵌媒体发送 `base64`。
- 本次设备验证通过手动刷新页面加载最新代码；版本轮询的触发时延未测，不据此声称自动热更通过。

## 预计工时

- 约 30 分钟。

## 实施结果

- `display.html` 仅接受 `url`、`base64` 作为兜底媒体消息；未知配置/状态类型不再停止播放列表、覆盖媒体或发送 media ack。
- `node --test tests/display-message-dispatch.test.js tests/display-media-payload.test.js tests/display-identity-batch-restore.test.js tests/display-playback-resume.test.js`：19/19 通过。
- Note8 的 `display-umwo5k6l` 经 WebView 主动断开并自动重连；抓到 `restoreState(video,isPlaying=true)`，随后收到 `ttsProviderConfig`、`chatModelTierConfig`；最终 `currentMediaType=video`、`readyState=4`、`paused=false`，媒体源保留并播放。
- `servicePackage=true` 待构建发布；本次仅刷新显示页验证，未构建或发布服务包。
