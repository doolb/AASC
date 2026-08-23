# Task 2 审查修复报告

## 修复范围

- P1：普通（非临时）`/upload-file` 现在识别 `.txt`、`.md` 为 `text`，并只为文本媒体发送 `format` 和 `mimeType`。
- P1：显示端播放列表切换当前项时，URL 和临时 base64 两条 `showMedia()` 输入路径均保留文本 `format`。
- P2：补充真实 Local provider、临时文本播放列表、普通上传协议和播放列表协议交接回归测试。

## RED 证据

执行：

```bash
node --test tests/text-media-metadata.test.js tests/playlist-app-service.test.js
```

结果：14 个测试中 12 通过、2 失败。

- 服务器没有 `detectTextFormat()`，且普通上传的 `mediaData` 不含文本 `format`/`mimeType`。
- `playCurrentItem()` 对 URL 与 base64 项重新组装时均遗漏 `format`。

## GREEN 证据

执行：

```bash
node --test tests/text-media-metadata.test.js tests/media-library-app-service.test.js tests/playlist-app-service.test.js tests/audio-media-ui.test.js tests/display-identity-batch-restore.test.js tests/display-playback-resume.test.js
node --check src/apps/server/boot/server-app.js
git diff --check
```

结果：41/41 通过；服务器语法检查和差异空白检查均通过。

## 改动文件

- `src/apps/server/boot/server-app.js`
  - 增加服务端文本类型、格式、MIME 映射；普通上传媒体消息透传该元数据。
- `src/apps/web-mediacenter/ui/public/display.html`
  - 当前播放列表项组装为 `mediaData` 时仅对文本项携带 `format`。
- `tests/text-media-metadata.test.js`
  - 增加真实 Local provider、临时文本列表及服务器/显示端协议回归覆盖。

## 自检与关注点

- 非文本媒体不新增 `format` 字段，既有音频和 HTML 路径继续由原有测试覆盖。
- 修复范围未实现显示端文本播放器、TTS 协议或控制设置。
- `server-app.js` 与 `display.html` 有既有用户脏改动；提交时仅暂存本修复对应 hunk。
