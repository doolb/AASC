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

## 测试改动

- `tests/playlist-app-service.test.js`
  - 新增 library 路径按 `mediaTypes` 筛选测试。
  - 新增旧客户端兼容测试（缺失/空数组/未知值）。
  - 新增 temp 路径按 `mediaTypes` 筛选并保留文本元数据测试。

- `tests/text-media-routing-task1.test.js`
  - 新增控制端批量弹窗五类复选框静态协议测试。
  - 新增控制端仅发送 `mediaTypes` 的静态协议测试。
  - 新增 `server-app` 透传 `mediaTypes` 的静态协议测试。

## 验证命令

```bash
node --test tests/playlist-app-service.test.js
node --test tests/text-media-routing-task1.test.js
node --test tests/text-media-metadata.test.js tests/text-media-playlist.test.js tests/audio-media-ui.test.js
node --check src/apps/web-mediacenter/modules/media/playlist-app-service.js
node --check src/apps/web-mediacenter/ui/public/js/media-library.js
node --check src/apps/server/boot/server-app.js
node --check tests/playlist-app-service.test.js
node --check tests/text-media-routing-task1.test.js
```

## 结果

- Task 1 focused tests 通过。
- 相关文本/批量/音频静态回归测试通过。
- 相关脚本语法检查通过。
- `tests/text-media-metadata.test.js` 中 `LocalProvider 从 txt 和 md 文件名生成 text format 元数据` 未通过，失败原因为当前环境对临时目录写文件直接返回 `Unknown system error -122`；独立最小复现 `fs.writeFileSync()` 同样失败，可判定为环境限制而非 Task 1 回归。

## 风险与说明

- 当前仅实现服务端类型筛选，不涉及文本语音路由状态、远程音频上下文和预生成缓存，因此不会改变现有文本 TTS 串行播放逻辑。
- `server-app.js` 工作区内存在用户未提交的其他改动；本次只在 `playlistRequest` 相关片段增量修改，提交时需要仅暂存 Task 1 相关 hunk。
