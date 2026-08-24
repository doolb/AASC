# Task 2 Review Fix Report

时间：2026-08-24

## 修复范围

只修复 Task 2 review 的两个 finding：

1. 服务器计算的文本语音 route 必须成为 `TextMediaTtsService` 的权威上下文，首次 `textSentenceTts` 不能信任显示端任意 route。
2. 远程 `textSentenceTtsFinished` 必须校验 origin/target/playbackId/pageIndex/sentenceIndex 对应服务器已下发的远程句子。

未实现 Task 3 预生成逻辑，未改普通 TTS。

## 根因

- `server-app` 只把 route 下发给显示端，没有把 route 注册到 `TextMediaTtsService`。首次 `textSentenceTts` 会由服务从显示端请求里的 `data.route` 创建上下文。
- `TextMediaTtsService` 下发 `textPlaybackRemote` 后没有记录句子定位；回执只校验 origin/target/playbackId 和目标能力，未证明 pageIndex/sentenceIndex 是刚下发过的句子。

## 实现

- `TextMediaTtsService`
  - 新增 `setDisplayRoute(originDisplayId, trustedRoute)`，保存服务器计算的 `selectedDisplayIds/selectedVoiceDisplayIds/voiceTargetDisplayId`。
  - 新增 `clearDisplayRoute(originDisplayId)`，清理服务器 route 和活跃播放上下文。
  - 新播放首次请求优先使用服务器注册 route；没有服务器注册 route 且请求携带 route 时返回 `textSentenceTtsError: 未注册服务器语音路由`。
  - 保留旧客户端无 route 的源端播放兼容路径。
  - 新增 `pendingRemoteSentences`，远程句子下发后记录 target/playbackId/pageIndex/sentenceIndex；回执命中后删除，取消或清理上下文后自动失效。

- `server-app`
  - `mediaBatch` 文本媒体下发前注册 `mediaForDisplay.route`。
  - `mediaBatch` 非文本媒体清理该显示端 route。
  - `playlistRequest` 对每个实际下发 `playlistStart` 的显示端注册对应 route。
  - `playlistControl stop` 清理 route。

- `text-media-ws-integration`
  - 文本播放 `stop` 时调用 `clearDisplayRoute`，同时保留 pause/prev/next 的既有 cancel 语义。

## 测试

新增/调整聚焦测试：

- `tests/text-media-tts-service.test.js`
  - 伪造 route 的首次请求被拒绝且不进入 TTS。
  - 错误句子定位的远程 finished 被拒绝。
  - 正确句子定位的远程 finished 被转发。

- `tests/text-media-integration.test.js`
  - 服务器在 `mediaBatch` 和 `playlistRequest` 中注册 route。
  - 停止播放时清理 route。

## 验证

- PASS：`node --test tests/text-media-tts-service.test.js tests/text-media-server-integration.test.js tests/text-media-integration.test.js`
  - 21/21 通过。

## 环境限制

按本轮要求未运行可能卡住的全套 text-media 测试。Task 2 review 已记录 `tests/text-media-markdown-pagination-dom.test.js` 在当前环境可能失败并超时，因此本轮只执行聚焦测试和静态检查。
