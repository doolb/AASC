# 控制端一键暂停所有录音设计

## 需求

控制端提供一个右下角圆形浮动按钮，用于一键暂停或恢复所有在线显示端的录音。按钮位于齿轮按钮上方的自测按钮正上方，只显示麦克风图标，悬停提示和 `aria-label` 显示“暂停所有录音”或“恢复所有录音”。

## 行为

- 服务端只在内存维护全局 `paused` 状态，初始值为 `false`；服务端重启后默认恢复录音。
- 控制端发送 `setGlobalRecordingPause`，服务端校验布尔值后广播权威 `globalRecordingPauseState`。
- 显示端连接初始化时收到当前状态，重连后继续遵循服务端状态。
- 暂停时停止普通 ASR 监听、阻止新的 ASR/临时录音请求，并终止正在进行的临时录音。
- 服务端在 ASR HTTP、音频流、显示端 ASR 回包和兼容 `voiceInput` 入口再次检查状态，丢弃暂停期间完成的在途结果。
- 恢复时只恢复普通监听；被终止的单次或实时临时录音不自动恢复。
- 不修改显示端能力配置、录音模式、声纹配置或播放时暂停录音配置。

## 浮动按钮

- 复用控制端现有 `FloatingControl` 区域的布局和主题变量。
- 使用圆形麦克风状态图标：正常状态显示麦克风，暂停状态显示红色麦克风并叠加斜杠；不在按钮主体显示长文本。
- 点击后先立即更新本地视觉状态，服务端广播到达后再用权威状态校正，避免网络往返期间图标看起来没有变化。
- 浮动按钮与齿轮、自测按钮保持右侧竖直排列，按钮之间保留可点击间距。
- 控制端重连或收到服务端广播时更新图标、颜色、提示文本和 `aria-label`。

## 受影响模块

- `src/apps/server/boot/server-app.js`：运行时状态、WebSocket 消息、ASR/临时录音门控。
- `src/apps/web-mediacenter/ui/public/upload.html`：浮动按钮宿主节点。
- `src/apps/web-mediacenter/ui/public/js/floating-control.js`：图标状态和控制端发送逻辑。
- `src/apps/web-mediacenter/ui/public/js/websocket.js`：接收服务端权威状态。
- `src/apps/web-mediacenter/ui/public/display.html`：浏览器显示端录音门控。
- `src/apps/voice-display-node/main.js`：Windows/Android Node 显示端录音门控。
- `tests/global-recording-pause.test.js`：消息契约、服务端门控和三类显示端行为测试。
