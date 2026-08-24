# Task 3 Implementation Report

## 范围

- 实现显示端本地下一句 TTS 预取：
  - 当前句音频开始后发送一次 `textSentenceTts(prefetch=true)`。
  - 预取回包只缓存定位与 `audioUrl`，不立即播放。
  - 当前句结束后优先消费缓存；预取未完成时等待；预取失败后回退普通请求。
  - 暂停、翻页、停止、新 `playbackId` 清理预取槽并忽略旧回包。
- 实现服务端预取协议：
  - `TextMediaTtsService` 识别 `prefetch`，每个播放上下文最多一个预取槽。
  - 本地目标回包 `textPlayback:true,prefetch:true`。
  - 远程目标回包 `textPlaybackRemote:true,prefetch:true`，并向源端发送 `textSentenceTtsReady(prefetch=true)`。
  - 预取错误回源端 `textSentenceTtsError(prefetch=true)`，不推进当前句。
- 远程显示端兼容处理：
  - `display.html` 接收 `textSentenceTtsReady` 并转给 `TextMediaPlayer.handleTtsReady()`。
  - 远程 `textPlaybackRemote(prefetch=true)` 只进入单个缓存槽，不抢占当前音频。
  - `stop` 和语音能力关闭时清理远程预取槽。

## 简化说明

- 按最新指令，本次优先提交核心本地/服务端预取。
- 远程缓存保持协议兼容和单槽缓存，不扩展复杂跨设备调度；旧无 `prefetch` 字段客户端仍走原有当前句串行播放与 `textSentenceTtsFinished` 回执。

## 修改文件

- `src/apps/web-mediacenter/ui/public/js/text-media-player.js`
- `src/apps/server/modules/media/text-media-tts-service.js`
- `src/apps/server/modules/media/text-media-ws-integration.js`
- `src/apps/web-mediacenter/ui/public/display.html`
- `tests/text-media-player.test.js`
- `tests/text-media-tts-service.test.js`
- `tests/text-media-server-integration.test.js`
- `tests/text-media-integration.test.js`
- `docs/design/text-media-routing.md`
- `docs/spec/text-media-routing.md`
- `docs/task/2026-08-24_批量媒体筛选与文本TTS路由预生成.md`
- `docs/todo.md`
- `changelog.md`

## 验证

- PASS: `node --test tests/text-media-player.test.js tests/text-media-tts-service.test.js tests/text-media-server-integration.test.js tests/text-media-integration.test.js`
- PASS: `node --test tests/text-media-player.test.js tests/text-media-tts-service.test.js`
- PASS: `node --check src/apps/web-mediacenter/ui/public/js/text-media-player.js`
- PASS: `node --check src/apps/server/modules/media/text-media-tts-service.js`
- PASS: `node --check src/apps/server/modules/media/text-media-ws-integration.js`
- PASS: `node --check tests/text-media-player.test.js`
- PASS: `node --check tests/text-media-tts-service.test.js`
- PASS: `node --check tests/text-media-server-integration.test.js`
- PASS: `node --check tests/text-media-integration.test.js`
- PASS: `git diff --check`

## 限制

- 未运行全套 DOM/浏览器测试，避免当前环境长时间卡住。
- `node --check src/apps/web-mediacenter/ui/public/display.html` 不适用于 `.html` 扩展；改用内联脚本检查时，当前 shell 返回 `disk quota exceeded`，因此未继续扩展验证。
