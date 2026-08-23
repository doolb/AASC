# Task 5 Report: 混合播放列表文本接入

## 实现

- 文本播放列表项进入 `TextMediaPlayer.attachPlaylist`，最终页完成后才调用 `playlistNext`。
- pause/resume/prev/next/jump/stop 清理或失效旧文本句子；暂停重连恢复时先重建当前页句子，随后从该页第一句重新请求。
- `playlistProgress` 传递并持久化 `pageIndex`、`pageTotal`、`sentenceIndex`、`sentenceTotal`、`format`；重连传递 `resumeTextPage`。
- 仅非临时列表持久化断点；临时 base64 不写入状态。控制端所有批量状态面板显示文本页码。

## 验证

`node --test tests/text-media-playlist.test.js tests/playlist-app-service.test.js tests/display-playback-resume.test.js tests/display-sleep-mode.test.js`

- 19 passed, 0 failed
- `node --check`：server-app、websocket、media-library、text-media-player 均通过
- `git diff --check` 通过
