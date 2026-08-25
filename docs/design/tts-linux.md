# Linux TTS 服务设计文档

## 功能目标

- 在纯 Linux 环境提供与 `tts-wine` 兼容的 HTTP TTS 服务。
- 使用 Microsoft Embedded Speech SDK 加载 Xiaoxiao 离线模型并输出 WAV。
- 正式运行时不依赖 `3rd/NaturalVoiceSAPIAdapter` 的目录、源码或构建产物。
- 保留模型、SDK 动态库和 Linux TTS 二进制可独立部署的边界。

## 运行时结构

```text
HTTP 客户端
    ↓ POST /api/tts
3rd/tts-server/tts-linux.js
    ↓ 有界 FIFO 队列
Linux TTS CLI 子进程
    ↓ Embedded Speech SDK
独立模型目录 + SDK 运行库
    ↓
24kHz/16bit/mono WAV
```

## 设计方案

- `tts-linux.js` 与 `tts-wine.js` 使用相同的 `/api/tts`、`/api/voices`、`/api/tts/status` 接口。
- 默认单并发，避免 Linux Embedded Speech SDK 在无 AVX 或低性能 CPU 上发生资源争用；并发、队列长度和超时时间由环境变量覆盖。
- 每个 HTTP 请求使用独立 CLI 子进程，完成后删除临时 WAV；通过进程边界限制 native SDK 内存累积。
- 二进制、模型目录和 SDK 动态库路径支持环境变量配置；Linux TTS 与 Wine TTS 使用同一授权串硬编码，避免部署时出现授权配置漂移。Linux/Wine SDK 原始压缩包保存在 `3rd/tts-server/sdk-archives`，使用普通 Git 提交；解压后的 SDK 目录只作为构建运行目录。
- CMake 禁止将构建机上的 SDK 绝对路径写入可执行文件；`cmake --install --prefix 3rd/tts-server/linux` 将 CLI 放入 `bin`、x64 SDK 动态库放入相邻 `lib`，也可通过 `TTS_LINUX_SDK_DIR` 指向外部运行库。
- Linux TTS 运行时已完成独立迁移，不再需要旧适配器目录作为参考或构建输入。

## 删除 NaturalVoiceSAPIAdapter 的兼容边界

旧适配器目录已从运行时依赖中移除；Linux TTS 二进制、模型目录和 SDK 运行库位于独立路径，`tts-linux.js` 不读取旧目录。

## 运行时自动准备

- `3rd/tts-server/scripts/prepare-runtime.sh` 优先从 `sdk-archives` 复用 Linux Embedded SDK 和 Wine 所需 NuGet 原始包，归档缺失时从 Microsoft 官方入口下载并保存，再按版本解压到独立运行时目录。
- Wine prefix 不复制旧目录；目标不存在时由 `WINEARCH=win64 WINEPREFIX=<目标> wineboot --init` 生成。
- Wine worker 编译和服务测试使用 `WINE_BIN_DIR`；脚本会从本次下载的 NuGet 包部署四个 `win-x64/native` DLL，避免误用旧 DLL。
- 脚本支持仅准备、仅构建和仅测试，重复执行时已存在且包含关键文件的 SDK/prefix 会跳过；源目录和已有目标不会被删除。
- 测试阶段分别编译 Linux CLI、Wine worker，并执行真实 WAV 合成；当前 CPU 不支持 AVX 时，Linux 合成失败应保留原始错误并标记环境限制。

## 风险与约束

- Linux 目标 CPU 必须支持 Embedded Speech SDK 所需的指令集；不满足时服务返回可诊断错误。
- 授权串按现有 APK/Wine 兼容要求硬编码在运行时入口；该做法会把授权暴露在源码和构建产物中，后续如需安全化应再改为受控密钥管理。
- 受 QEMU TCG 验证的 100 字文本耗时较长，默认单并发和较长请求超时是有意的保护策略。
