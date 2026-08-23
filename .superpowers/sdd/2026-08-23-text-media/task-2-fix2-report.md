# Task 2 第二轮审查修复报告

## 根因

`537e41d` 的零上下文索引补丁落在错误位置：文本对象展开进入 `/media-list` 的局部声明，文本类型判断进入无关的能力广播函数，导致提交对象无法通过 Node 语法检查。

## 修复

- 新增 `src/apps/server/modules/media/upload-media-metadata.js`。
  - 该模块提供唯一的 `detectMediaType(name)`、文本格式/MIME 映射及普通上传实际使用的 `createUploadedMediaData()`。
- `/upload-file` 直接调用 `createUploadedMediaData()`，由返回值发送到显示端。
  - `.md`：`mediaType: text`、`format: markdown`、`mimeType: text/markdown`。
  - `.txt`：`mediaType: text`、`format: plain`、`mimeType: text/plain`。
  - 非文本媒体不包含 `format` 或 `mimeType` 新字段。
- 回归测试直接执行该实际构造函数并断言上述三类消息对象；不再以工作树源码正则代替协议行为验证。

## RED 证据

执行 `node --test tests/text-media-metadata.test.js`：6 个测试中 5 通过、1 失败。

失败项为普通上传媒体构造器不存在（`typeof createUploadedMediaData === 'object'`，预期 `function`）。

## GREEN 证据

```bash
node --test tests/text-media-metadata.test.js tests/media-library-app-service.test.js tests/playlist-app-service.test.js tests/audio-media-ui.test.js tests/display-identity-batch-restore.test.js tests/display-playback-resume.test.js
node --check src/apps/server/boot/server-app.js
node --check src/apps/server/modules/media/upload-media-metadata.js
git diff --check
```

结果：41/41 通过；两个 Node 语法检查与空白差异检查通过。

提交后还将对新提交对象执行：

```bash
git show NEW_COMMIT:src/apps/server/boot/server-app.js | node --check -
```

## 范围说明

仅修改普通上传元数据构造与其回归测试，未修改显示端文本播放器、TTS 协议或控制设置；保留所有既有用户脏改动。
