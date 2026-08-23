# Task 2：文本媒体元数据、上传与播放列表流转报告

## RED 证据

执行命令：

```bash
node --test tests/text-media-metadata.test.js tests/playlist-app-service.test.js
```

结果：10 个测试中 8 通过、2 失败。

- `detects txt and md as text with the correct format`：`note.txt` 实际被识别为 `image`，预期为 `text`。
- `library playlist keeps text format metadata`：播放列表过滤了 `text` 类型，首项为 `undefined`。

失败原因与本任务新增需求一致，确认测试有效后才开始生产代码修改。

## GREEN 与验证证据

执行命令：

```bash
node --test tests/text-media-metadata.test.js tests/media-library-app-service.test.js tests/playlist-app-service.test.js tests/audio-media-ui.test.js
```

结果：29/29 通过，0 失败。

执行语法检查：

```bash
node --check src/apps/web-mediacenter/modules/media/media-library-app-service.js
node --check src/apps/web-mediacenter/modules/media/playlist-app-service.js
node --check src/apps/web-mediacenter/ui/public/js/upload.js
node --check src/apps/web-mediacenter/ui/public/js/media-library.js
node --check src/apps/web-mediacenter/ui/public/js/websocket.js
node --check src/apps/web-mediacenter/ui/public/js/crop.js
```

结果：全部以退出码 0 完成。

## 变更文件

- `src/apps/web-mediacenter/modules/media/media-library-app-service.js`
  - `.txt`、`.md` 识别为 `text`，并映射为 `plain`、`markdown`。
  - Local、HTTP、SMB 媒体库列表和文件查询仅为文本项附加 `format`。
- `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
  - 文本加入可播放类型；库和临时播放列表保留文本格式字段，其他媒体字段保持不变。
- `src/apps/web-mediacenter/ui/public/js/upload.js`
  - 上传检测、单个临时发送和临时批量准备均发送文本类型、格式、文件名与 MIME。
- `src/apps/web-mediacenter/ui/public/js/media-library.js`
  - 从媒体库单发文本时发送格式、文件名与 MIME；文本缩略图使用黄底深灰占位。
- `src/apps/web-mediacenter/ui/public/js/websocket.js`
  - 文本媒体比例固定为 `1`。
- `src/apps/web-mediacenter/ui/public/js/crop.js`
  - 文本预览不尝试图片解码，改用黄底深灰文件名占位。
- `src/apps/web-mediacenter/ui/public/upload.html`
  - 单文件和媒体库批量文件选择器接受 `.txt,.md`。
- `tests/text-media-metadata.test.js`
  - 新增文本类型/格式与库播放列表格式保留的回归测试。
- `tests/playlist-app-service.test.js`
  - 更新既有文本测试夹具和预期，使其验证文本被纳入播放列表并保留格式。

## 自检

- 非文本播放列表项不会获得新的 `format` 字段。
- HTML 与音频原有发送分支及其既有测试保持通过。
- 已检查任务文件差异，未重置、检出、暂存或修改用户已有的无关脏改动。

## 关注点

- 本任务只完成元数据和控制端流转；显示端文本播放器、服务端 TTS 协议及控制设置按范围要求未实现。
- 远程 HTTP/SMB 列表的文本格式从文件扩展名推导，和本地库行为一致。
