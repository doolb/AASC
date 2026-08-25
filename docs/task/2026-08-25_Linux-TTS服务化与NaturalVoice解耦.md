# Linux TTS 服务化与 NaturalVoice 解耦

## 任务描述

参考 `3rd/tts-server/tts-wine.js`，将 `NaturalVoiceSAPIAdapter` Linux TTS PoC 形成独立的 `tts-linux` HTTP 服务，并为后续删除 `3rd/NaturalVoiceSAPIAdapter` 保留独立运行时边界。

## Design 需求

- 新增与 Wine TTS 兼容的 `/api/tts`、`/api/voices`、`/api/tts/status`。
- Linux TTS 默认单并发、FIFO 队列、队列上限、超时、断连清理和临时文件清理。
- 二进制、模型和授权配置不依赖 `NaturalVoiceSAPIAdapter` 路径。

## Spec 设计

- 见 `docs/spec/tts-linux.md`。
- Linux CLI 输出 24kHz/16bit/单声道 WAV。
- `tts-linux.js` 通过可配置 CLI 路径调用独立 Linux TTS 实现。

## 受影响的功能模块和代码

- `3rd/tts-server/tts-linux.js`
- `3rd/tts-server/tts-wine.js`
- `3rd/tts-server/scripts/prepare-runtime.sh`
- `3rd/tts-server/sdk-archives/` 及其 `README.md`、`SHA256SUMS`
- `3rd/tts-server/wine/runtime/prefix`
- `3rd/tts-server/linux/CMakeLists.txt`
- `3rd/tts-server/linux/src/tts_linux.cpp`
- `3rd/tts-server/linux/README.md`、`3rd/tts-server/linux/.gitignore`
- `3rd/tts-server/docs/design/tts-linux.md`、`3rd/tts-server/docs/spec/tts-linux.md`
- `3rd/tts-server/docs/design.md`、`3rd/tts-server/docs/spec.md`、`3rd/tts-server/docs/todo.md`、`3rd/tts-server/changelog.md`
- `tests/tts-linux.test.js`
- `tests/tts-runtime-migration.test.js`
- `docs/design/tts-linux.md`、`docs/spec/tts-linux.md`
- `docs/design/tts.md`、`docs/spec/tts.md`、`docs/design.md`、`docs/spec.md`
- `docs/todo.md`、`changelog.md`

## 自测用例

1. 默认运行时路径不包含 `NaturalVoiceSAPIAdapter`。
2. `/api/tts` 成功返回 WAV，并透传 voice/speed 参数。
3. 空文本返回 400，语音列表返回默认语音。
4. 队列满、TTS 子进程失败、超时和断连均释放队列并清理临时文件。
5. 在具备 Linux SDK、模型和 AVX 的环境中实际生成 WAV，并用 `file` 校验格式。
6. 校验 Linux/Wine/APK 使用同一硬编码授权，Linux 忽略外部授权覆盖；校验默认 Wine prefix 位于新运行时目录且关键注册表文件完整。
7. 使用脚本从 Microsoft 官方地址下载 SDK、使用 `wineboot --init` 生成 prefix，并分别运行 Linux/Wine 真实 WAV 测试。
8. 验证原始 SDK 压缩包保存在 `sdk-archives`，SHA256 校验通过，普通 Git 可直接跟踪；不使用 Git LFS。

## 兼容性测试

- Node.js HTTP 客户端兼容现有 `src/external/tts/tts-service.js`。
- Linux x86_64；不依赖 Windows API、COM、注册表或 Wine。
- 删除 `3rd/NaturalVoiceSAPIAdapter` 后，只要独立运行时资源存在，服务路径解析不变。

## 性能测试

- 默认单并发，记录请求耗时、队列等待时间和进程 RSS。
- 使用 100 字文本进行连续请求，确认临时文件和子进程均能回收。

## 风险评估

- SDK/CPU 不兼容：启动或请求失败时返回原始 stderr，便于定位。
- 授权串硬编码：按用户要求与 APK/Wine 统一硬编码；密钥会暴露在源码和构建产物中，后续安全化需另行设计。
- Linux TTS 初始化耗时较长：默认超时 300 秒，并限制并发避免资源争用。

## 预计工时

约 1 个工作日，包含服务、独立 CLI、测试、文档和可用环境验证。

## 执行记录

- 2026-08-25：完成 Linux TTS 运行时解耦设计和首批 HTTP 回归测试（先红）。
- 2026-08-25：完成 `tts-linux.js`、独立 Linux CLI/CMake、队列回归和文档同步。
- 2026-08-25：验证 HTTP/队列回归 5/5；CMake 编译通过；真实合成在当前主机 exit 132，原因为 Embedded Speech SDK 需要 AVX，待在支持 AVX 的 Linux 主机或 QEMU 环境复测。
- 2026-08-25：Linux Embedded SDK 迁移目标确定为 `3rd/tts-server/linux/sdk`；Wine 编译 SDK 迁移目标确定为 `3rd/tts-server/wine/runtime/sdk-win41`，均保留旧源目录作为回滚副本。
- 2026-08-25：统一 Linux/Wine/APK 硬编码授权串；Wine prefix 迁移到 `3rd/tts-server/wine/runtime/prefix`，旧 prefix 保留作为回滚副本。
- 2026-08-25：授权与运行时迁移回归 4/4；Linux HTTP/队列回归 5/5；Wine worker 使用迁移后的 SDK 编译通过。
- 2026-08-25：补充 Linux CMake 安装布局，`cmake --install` 将 CLI 放入 `linux/bin`、x64 SDK 动态库放入 `linux/lib`，与 `$ORIGIN/../lib` 对齐；安装后运行库解析校验通过。
- 2026-08-25：确认 SDK 改为 Microsoft 官方网络下载，Wine prefix 改为 `wineboot --init` 命令生成；新增自动准备、构建和双端测试脚本任务。
- 2026-08-25：脚本 TDD 回归 2/2；真实临时运行时验证 Linux SDK 下载/编译/WAV 通过，Wine 四个 NuGet SDK 下载、prefix 生成、worker 编译/WAV 通过；临时运行时未覆盖正式目录。
- 2026-08-25：补充 `WINE_BIN_DIR`，将本次下载的四个 Wine x64 DLL 部署后再测试；使用全新 DLL 目录重新验证 Linux/Wine WAV 均通过。
- 2026-08-25：按普通 Git 归档要求，将 Linux SDK tar.gz 与四个 Wine nupkg 保存到 `3rd/tts-server/sdk-archives`，补充 SHA256SUMS；脚本优先复用归档包，不在构建结束时删除。
