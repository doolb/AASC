# Task 3 实现报告：单句文本媒体 TTS 与 WebSocket 协议

## 完成内容

- 新增 `src/apps/server/modules/media/text-media-tts-service.js`。
  - 每个显示端独立串行处理分句请求，不阻塞其他显示端。
  - 每句单独调用 `generateTTS`，并将文件路径转换为 `/uploads/tts/<basename>`。
  - 成功回包包含 `tts/playAudio`、`textPlayback` 与播放定位标签。
  - 校验无效请求和 TTS 失败时发送带相同定位字段的 `textSentenceTtsError`，记录错误且不抛出到 WebSocket 循环。
  - 取消使用不可复用令牌：相同 playbackId 被取消后再次播放时，取消前的异步回包仍会被丢弃。
- 在 `server-app.js` 注册显示端 `textSentenceTts` 和 `textProgress`。
- 通过既有 `persistDisplayState` 保存 `textStyle` 与限定字段的 `currentTextProgress`；不保存临时播放列表的 base64 文本。
- `control/textPlayback` 原样转发到显示端，并在暂停、翻页、停止时取消当前未完成的分句回包。
- 通用 `tts` 分支未修改。

## TDD 记录

1. 新服务测试首先因模块不存在而失败。
2. 实现最小服务后，补充并验证“取消后复用 playbackId”仍丢弃旧音频的回归测试：该测试先失败，再以播放令牌修复后通过。

## 验证结果

执行命令：

```text
node --test tests/text-media-tts-service.test.js tests/agent-chat-tts.test.js tests/tts*.test.js
node --check src/apps/server/modules/media/text-media-tts-service.js
node --check src/apps/server/boot/server-app.js
git diff --check
```

结果：12 个 focused tests 全部通过；两项语法检查与 diff 检查均通过。
