# Task 1 实现/测试报告

## 实现范围

- 仅实现 Task 1：批量媒体类型协议与服务器筛选。
- 未实现手动语音设备路由、远程 TTS 播放完成回执、下一句预生成缓存。

## 代码改动

- `src/apps/web-mediacenter/ui/public/js/media-library.js`
  - 共用批量设置弹窗新增 `text/audio/image/video/web` 五类复选框。
  - 默认全部勾选。
  - 确认时仅收集勾选值并发送 `mediaTypes`，不在控制端筛选文件。

- `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
  - 新增服务端统一 `mediaTypes` 规范化逻辑。
  - 映射规则：`web -> html`，`image -> image + gif`。
  - `buildFromLibrary` 与 `buildFromTemp` 统一按规范化结果筛选。
  - `mediaTypes` 缺失、空数组或未知值时回退为全部类型，兼容旧客户端。

- `src/apps/server/boot/server-app.js`
  - `playlistRequest` 的媒体库和临时播放两条路径都透传 `data.mediaTypes` 给 `PlaylistManager`。
  - 不在 `server-app` 重复维护媒体类型映射规则。

## reviewer fix：临时批量预览顺序对齐

- 根因
  - Task 1 已将临时批量播放的媒体类型筛选与排序放到服务端执行。
  - 控制端此前仍使用原始 `tempPlaylistFiles[index]` 跟随 `playlistProgress.index` 更新裁剪预览。
  - 当服务端对 temp 列表执行筛选或排序后，服务端最终播放顺序与控制端原始缓存顺序不再一致，导致裁剪预览错位。

- 修复原则
  - 不在控制端做任何媒体类型筛选。
  - 由服务端在 `playlistStarted` 中回传最终 temp 播放列表元数据，且不包含 base64。
  - 控制端仅基于服务端最终顺序与可靠键 `tempPreviewKey` 对齐本地缓存预览数据。

- 本次新增/修改
  - `src/apps/web-mediacenter/ui/public/js/temp-playlist-preview.js`
    - 新增临时播放预览对齐工具。
    - 负责生成 `tempPreviewKey`、按服务端最终 playlist 顺序重建本地预览队列、按可靠键优先查找当前预览项。
  - `src/apps/web-mediacenter/ui/public/upload.html`
    - 注入 `temp-playlist-preview.js`。
  - `src/apps/web-mediacenter/ui/public/js/upload.js`
    - 临时文件预处理阶段为每个文件生成 `tempPreviewKey`。
    - 批量确认后仅缓存原始本地临时文件，等待服务端回传最终 temp playlist 元数据后再重建预览顺序。
  - `src/apps/web-mediacenter/ui/public/js/media-library.js`
    - 新增 `setPendingTempPlaylistFiles` 与 `handleTempPlaylistStarted`。
    - 裁剪预览优先按 `tempPreviewKey` 对齐，避免继续依赖原始 index。
  - `src/apps/web-mediacenter/ui/public/js/websocket.js`
    - 收到 temp `playlistStarted` 后，驱动控制端按服务端回传 metadata 重建预览顺序。
    - 还原当前播放状态时透传 `tempPreviewKey`。
  - `src/apps/web-mediacenter/modules/media/playlist-app-service.js`
    - `buildFromTemp` 保留 `tempPreviewKey`、`width`、`height`，供服务端回传最终 temp playlist 元数据。
  - `src/apps/server/boot/server-app.js`
    - temp 批量播放开始时，向控制端返回最终 temp playlist metadata（无 base64）。
    - temp 播放进度回传 `tempPreviewKey`，保证控制端可按可靠键跟随预览。

## 测试改动

- `tests/playlist-app-service.test.js`
  - 新增 library 路径按 `mediaTypes` 筛选测试。
  - 新增旧客户端兼容测试（缺失/空数组/未知值）。
  - 新增 temp 路径按 `mediaTypes` 筛选并保留文本元数据测试。

- `tests/text-media-routing-task1.test.js`
  - 新增控制端批量弹窗五类复选框静态协议测试。
  - 新增控制端仅发送 `mediaTypes` 的静态协议测试。
  - 新增 `server-app` 透传 `mediaTypes` 的静态协议测试。
  - 新增 reviewer fix 静态协议测试，校验 temp playlist metadata 回传与控制端对齐逻辑。

- `tests/temp-playlist-preview.test.js`
  - 新增服务端最终顺序重建测试。
  - 新增按 `tempPreviewKey` 优先对齐测试。

## 验证命令

```bash
node --test tests/playlist-app-service.test.js tests/text-media-routing-task1.test.js tests/temp-playlist-preview.test.js
node --check src/apps/web-mediacenter/modules/media/playlist-app-service.js
node --check src/apps/web-mediacenter/ui/public/js/temp-playlist-preview.js
node --check src/apps/web-mediacenter/ui/public/js/media-library.js
node --check src/apps/web-mediacenter/ui/public/js/upload.js
node --check src/apps/web-mediacenter/ui/public/js/websocket.js
node --check src/apps/server/boot/server-app.js
node --check tests/playlist-app-service.test.js
node --check tests/text-media-routing-task1.test.js
node --check tests/temp-playlist-preview.test.js
```

## 结果

- Task 1 reviewer fix 聚焦测试通过：`18/18 pass`。
- 相关脚本语法检查通过。

## 风险与说明

- 当前仅实现服务端类型筛选，不涉及文本语音路由状态、远程音频上下文和预生成缓存，因此不会改变现有文本 TTS 串行播放逻辑。
- `server-app.js` 工作区内存在用户未提交的其他改动；本次只在 `playlistRequest` 相关片段增量修改，提交时需要仅暂存 Task 1 相关 hunk。
- reviewer fix 仍严格保持“控制端不做媒体类型筛选”，控制端只负责用服务端最终 temp playlist metadata 对齐本地预览缓存。
