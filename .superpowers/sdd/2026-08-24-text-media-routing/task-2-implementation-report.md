# Task 2 实现报告：手动能力语音路由与远程播放回执

## 任务范围

- 复用控制端显示端能力编辑器，补充 `voicePlayback` 是手动语音路由开关的中文说明。
- 服务器在 `mediaBatch` 和 `playlistRequest` 中，按本次选中的 `displayIds` 为文本媒体计算 `voiceTargetDisplayId`。
- 文本 TTS 支持源端本地播放和远程语音显示端播放；远程播放结束/失败后通过 `textSentenceTtsFinished` 回执推进源端句子。
- 暂停、翻页、停止和新播放标识会让旧 TTS/远程回执上下文失效。

## 实现摘要

- `src/apps/server/boot/server-app.js`
  - 新增文本语音路由辅助函数：规范化选中显示端、筛选在线手动语音设备、按源端优先规则计算目标。
  - `mediaBatch` 对每个文本源显示端分别下发 `route`、`selectedDisplayIds`、`selectedVoiceDisplayIds`、`voiceTargetDisplayId`。
  - `playlistRequest` 下发并持久化 `voiceRouteByDisplayId`，恢复播放列表时保留路由字段。
  - `createTextMediaTtsService` 注入 `getDisplayCapabilities`，让 TTS 服务校验目标仍在线且启用 `voicePlayback`。
- `src/apps/server/modules/media/text-media-tts-service.js`
  - 新增播放上下文保存、显式 route 校验、远程 `textPlaybackRemote` 下发、`textSentenceTtsFinished` 校验转发。
  - route 缺失时按旧协议回源端 `textPlayback`，保持旧显示端兼容。
- `src/apps/server/modules/media/text-media-ws-integration.js`
  - 注册 `textSentenceTtsFinished` 显示端消息路由。
- `src/apps/web-mediacenter/ui/public/js/text-media-player.js`
  - 保存并随 `textSentenceTts` 携带 route。
  - 新增 `handleTtsFinished`，远程回执按当前句定位推进。
- `src/apps/web-mediacenter/ui/public/display.html`
  - 新增 `textPlaybackRemote` 音频播放和 ended/failed 回报。
  - 播放列表文本项从 `voiceRouteByDisplayId` 取当前显示端 route。
- `src/apps/web-mediacenter/ui/public/js/display-list.js`
  - 能力编辑器文案说明 `voicePlayback` 是手动路由开关。
- `src/apps/web-mediacenter/ui/public/js/device-list.js`
  - 同步能力编辑器文案。

## TDD 记录

先新增失败测试并确认 RED：

- `node --test tests/text-media-tts-service.test.js`
  - RED：`service.setPlaybackContext is not a function`
- `node --test tests/text-media-server-integration.test.js`
  - RED：缺少 `textSentenceTtsFinished` 注册路由
- `node --test tests/text-media-player.test.js`
  - RED：缺少 `loadRoute` / `handleTtsFinished`
- `node --test tests/text-media-integration.test.js`
  - RED：缺少远程协议、能力文案和服务器路由字段

实现后聚焦 GREEN：

- `node --test tests/text-media-player.test.js`：10/10 通过
- `node --test tests/text-media-tts-service.test.js tests/text-media-server-integration.test.js tests/text-media-integration.test.js`：19/19 通过

## 验证

已运行：

- `node --test tests/text-media-player.test.js`
- `node --test tests/text-media-tts-service.test.js tests/text-media-server-integration.test.js tests/text-media-integration.test.js`

待最终交付前继续运行：

- 聚焦测试全集
- `node --check` 相关脚本
- `git diff --check`

## 限制说明

- 当前会话没有可用的 subagent spawn/wait/list 工具；计划要求的独立子代理 reviewer 无法实际调度。本次以本地自审、聚焦测试和最终 diff 检查替代，并保留本报告。
- 当前工作区已有大量非 Task 2 改动；提交时必须只暂存 Task 2 相关 hunk，避免带入其他用户改动。
