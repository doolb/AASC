# Linux TTS 服务设计

## 目标

提供与 Wine TTS 相同 HTTP 协议的纯 Linux Embedded Speech TTS 服务，并把 Linux 二进制、模型与 SDK 运行时从 `NaturalVoiceSAPIAdapter` 子模块中独立出来。

## 运行规则

- `tts-linux.js` 使用有界 FIFO 队列，默认单并发。
- 每个请求调用独立 Linux CLI 子进程，完成后删除临时 WAV。
- 二进制、模型和 SDK 动态库通过环境变量配置；Linux TTS 与 Wine TTS 使用同一硬编码授权串。原始 Linux/Wine SDK 压缩包保存在 `3rd/tts-server/sdk-archives` 并由普通 Git 提交；解压后的 SDK 目录只作为构建运行目录。
- CMake 不把构建机 SDK 绝对路径写入可执行文件；`cmake --install --prefix 3rd/tts-server/linux` 将 CLI 和 x64 SDK 动态库放入 `$ORIGIN/../lib` 对应布局，也支持 `TTS_LINUX_SDK_DIR` 外部运行库。

## 接口

- `POST /api/tts`：接收 `text`、`voice`、`speed`，返回 `audio/wav`。
- `GET /api/voices`：返回配置的语音列表。
- `GET /api/tts/status`：返回队列、并发、路径和超时状态。

## 迁移边界

删除 `NaturalVoiceSAPIAdapter` 前，把独立 CLI、模型、SDK 运行库和 Wine prefix 迁移到新路径；服务代码不再拼接旧子模块路径。Wine prefix 使用 `wine/runtime/prefix`，旧 prefix 暂时保留作回滚副本。

运行时由 `scripts/prepare-runtime.sh` 自动准备：SDK 从 `sdk-archives` 中复用原始压缩包；归档缺失时从 Microsoft 官方 Linux 下载入口和 NuGet 下载入口下载并保存。Wine prefix 使用 `wineboot --init` 生成，不复制旧 prefix。

默认下载入口为 `https://aka.ms/csspeech/linuxembeddedbinary` 和 Microsoft NuGet 1.51.2 包；下载地址及 SHA256 可通过环境变量覆盖。
