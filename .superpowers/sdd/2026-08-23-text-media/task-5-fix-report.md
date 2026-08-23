# Task 5 P1 修复报告：异步文本加载代次隔离

## 修复范围

- `src/apps/web-mediacenter/ui/public/js/text-media-player.js`
- `tests/text-media-playlist.test.js`

## 根因

旧的 `TextMediaPlayer.load()` 在 URL 文本的异步 fetch/text 解码完成后，未验证该加载是否仍属于当前播放项。播放列表的 pause、next、prev、jump、stop 和切项虽会调用文本播放器控制逻辑，但迟到的旧 load 仍可能写入页面状态、发送 `textSentenceTts`，或通过原列表上下文触发完成回调。

## 修复

- 每次 `load()` 创建递增的独立 load token，并为 URL fetch 创建 `AbortController`。
- 新 load、暂停加载中的文本、停止文本和测试加载入口都会使旧 token 失效并中止未完成请求。
- fetch 返回、`response.text()` 返回、`load()` 的结果处理和异常处理均确认 token 仍为当前且状态不是 `stopped`；过期结果直接退出，不写入 `rawText/pages/state`、不发送 TTS、也不触发完成回调。
- 暂停发生在加载中时，恢复操作会以新的 token 重新加载当前 source。
- 播放列表现有 `playCurrentItem()` 切项前 `TextMediaPlayer.stop()` 与 pause 控制接线保持不变，因此 next/prev/jump/stop/切项均会使旧 load 失效，混合列表分支不变。

## 回归测试

- 延迟 URL 文本在 pause 后模拟 next 切至图片：迟到返回后状态仍为 `stopped`，没有页面和 `textSentenceTts`。
- 文本 A 尚未返回时切至文本 B：B 完成后 A 的迟到返回不得覆盖页面或额外发送 TTS。

## 验证

- 已运行 Task 5 focused tests、`node --check` 与 `git diff --check`。
- 提交前复核提交对象仅包含本修复涉及的播放器、测试和本报告；已有 Task 4 的播放器修复随当前正确工作树保留。
