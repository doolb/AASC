# 变更日志

## 2026-08-25

- 新增：`tts-linux.js` 及 `linux/` 独立构建入口，提供 Linux Embedded Speech TTS HTTP 服务。
- 兼容：接口与 `tts-wine.js` 保持一致，支持 FIFO 队列、队列上限、单并发、超时、临时文件清理和状态查询。
- 解耦：默认运行时路径不再依赖 `NaturalVoiceSAPIAdapter`；CMake 使用可迁移的 `$ORIGIN/../lib` 运行库路径。
- 测试：Linux TTS HTTP/队列回归 5 项通过，CLI CMake 编译通过；真实合成受当前主机 AVX 指令集限制，记录为环境限制。
- 迁移：Linux Embedded SDK 目标为 `linux/sdk`，Wine 编译 SDK 目标为 `wine/runtime/sdk-win41`，Wine prefix 目标为 `wine/runtime/prefix`；旧 NaturalVoice 源目录暂保留。
- 统一：Linux/Wine/APK 使用同一硬编码授权串；Linux 服务忽略 `TTS_LINUX_LICENSE/MS_TTS_KEY` 外部授权覆盖。
- 构建：Linux CMake 提供 `cmake --install`，生成 `bin` + `lib` 可迁移运行时布局。
- 自动化：新增 `scripts/prepare-runtime.sh`，下载 Microsoft SDK、生成 Wine prefix、编译并测试 Linux/Wine TTS。
- Wine 运行时：准备脚本支持 `WINE_BIN_DIR`，部署本次下载的 x64 DLL 后再执行测试。
- SDK 归档：Linux SDK tar.gz 与四个 Wine nupkg 保存在 `sdk-archives`，补充 `SHA256SUMS`，使用普通 Git 提交，不使用 Git LFS；构建结束不删除原始压缩包。

- 修复：`tts-wine.js` 将队列任务绑定到 `drain()` 已预留的 Wine worker，恢复 `/api/tts` 与 `/api/voices` 正常请求。
- 优化：参考 `tts.js` 增加 FIFO 队列的断连清理、排队超时、队列上限和状态字段。
- 测试：固定 100 字文本集成、并发队列、断连恢复和 100 次 HTTP 压测全部完成；发现 RSS 从约 270MB 增长到约 430MB，保留为后续 SDK 句柄专项风险。

## 2026-04-17

- 修复：`/api/tts` 在生成失败、参数校验失败时统一返回 JSON 错误结构，便于调用方识别失败原因。
- 优化：`/api/voices` 失败返回结构统一为 `success: false`，减少前后端错误处理分支差异。
