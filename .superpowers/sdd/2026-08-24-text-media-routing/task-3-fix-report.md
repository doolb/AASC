# Task 3 Review-Fix Report

## 目标

只修 P1：源端 `pause/prev/next/stop`、route replacement、`clearDisplayRoute` 或新 `playbackId` 后，远程语音设备不能继续播放或消费旧的远程预取缓存。

## 根因

- 服务端 `cancel()` 和 route 清理只删除源端 active playback，没有向远程 `voiceTargetDisplayId` 下发停止协议。
- 远程 `display.html` 的旧 `ended/error` 回调仍可在源端取消后读取 `remotePrefetchedTextPlayback` 并自动播放。
- 远程预取消费只校验 `originDisplayId/voiceTargetDisplayId/playbackId`，没有校验下一句 `pageIndex/sentenceIndex`。

## 修复

- `src/apps/server/modules/media/text-media-tts-service.js`
  - 新增远程 stop 下发逻辑：当当前上下文有远程语音目标时，发送 `tts/action:'stop'/textPlaybackRemote:true/originDisplayId/voiceTargetDisplayId/playbackId`。
  - `cancel()`、`setDisplayRoute()`、`clearDisplayRoute()`、`setPlaybackContext()` 的新 playback 覆盖，以及 `getOrCreatePlaybackContext()` 的新 `playbackId` 路径，均先发远程 stop，再失效旧 active/pending/prefetch 上下文。
  - 本地语音目标保持兼容，不发送远程 stop。
- `src/apps/web-mediacenter/ui/public/display.html`
  - 收到明确远程 stop 时暂停 `ttsAudio`，清空当前远程播放和远程预取槽。
  - 增加 `remoteTextPlaybackToken`，让 stop 或新上下文后的旧 `ended/error` 回调只能清理监听器，不能发送 finished 或消费旧缓存。
  - 远程预取消费必须匹配同一 `originDisplayId/voiceTargetDisplayId/playbackId`，并且 `pageIndex` 相同、`sentenceIndex` 为当前句下一句。
- 测试
  - `tests/text-media-tts-service.test.js` 覆盖远程 cancel 发 stop、本地 cancel 不发 stop、route replacement/clear/新 playbackId 发 stop。
  - `tests/text-media-integration.test.js` 增加 display 协议静态守卫，覆盖远程 stop 清理和下一句定位校验。

## 验证

已运行：

- `node --test tests/text-media-player.test.js tests/text-media-tts-service.test.js tests/text-media-server-integration.test.js tests/text-media-integration.test.js`
  - 结果：42/42 pass
- `node --check src/apps/server/modules/media/text-media-tts-service.js`
  - 结果：pass
- `node --check src/apps/server/modules/media/text-media-ws-integration.js`
  - 结果：pass
- `node --check src/apps/web-mediacenter/ui/public/js/text-media-player.js`
  - 结果：pass

按用户要求停止测试并不运行长浏览器测试。`git diff --check` 若未运行，以此限制记录为准。

## 提交范围

只包含本 P1 修复相关代码、测试、文本媒体文档记录和本报告；不包含 `server-app.js`、Pi、LLM、日志或配置文件的既有脏改。
