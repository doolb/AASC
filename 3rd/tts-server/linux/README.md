# Linux Embedded Speech TTS

这里是独立的 Linux TTS CLI 构建入口，不依赖旧适配器源码目录。

## 自动准备 SDK、prefix 和测试

在 `3rd/tts-server` 目录执行：

```sh
cd 3rd/tts-server
npm run prepare:runtime -- --allow-test-failure
```

脚本优先复用 `../sdk-archives` 中已提交的 Linux Embedded SDK 和 1.51.2 Wine NuGet 原始包；归档缺失时才从 Microsoft 官方地址下载并保存。脚本随后执行 `wineboot --init` 生成 prefix，再编译并测试 Linux/Wine TTS。原始压缩包在构建结束后保留。正常验收时不要加 `--allow-test-failure`；该选项仅用于当前 CPU 不支持 AVX 等环境限制的机器。

默认下载入口：

- Linux Embedded SDK：`https://aka.ms/csspeech/linuxembeddedbinary`
- Wine SDK：Microsoft NuGet 的 Speech、Embedded.TTS、ONNX.Runtime、Telemetry 1.51.2 包

可用 `LINUX_SDK_URL`、`WINE_*_URL` 和对应 `*_SHA256` 环境变量覆盖地址并校验下载文件。

也可以分别执行 `npm run prepare:runtime:prepare`、`npm run prepare:runtime:build`、`npm run prepare:runtime:test`；测试使用 `WINE_BIN_DIR` 指定 Wine worker 和 SDK DLL 的目录。

## 构建

```sh
cd 3rd/tts-server/linux
TMPDIR=/dev/shm cmake -B /dev/shm/aasc-tts-linux-build \
  -DSPEECH_SDK_DIR="$PWD/sdk/SpeechSDK-Embedded-Linux-1.51.2"
TMPDIR=/dev/shm cmake --build /dev/shm/aasc-tts-linux-build -j2
cmake --install /dev/shm/aasc-tts-linux-build --prefix "$PWD"
```

## 运行服务

模型和解压后的 SDK 动态库不提交到仓库，通过环境变量配置；原始 SDK 压缩包提交在 `../sdk-archives`；授权串由 `tts-linux.js` 使用与 Wine/APK 相同的硬编码值：

```sh
TTS_LINUX_BIN=/path/to/tts_linux \
TTS_LINUX_MODEL_DIR=/path/to/models/extracted \
node ../tts-linux.js
```

安装命令会将 x64 SDK 动态库复制到 `linux/lib`，与 CLI 的 `$ORIGIN/../lib` RUNPATH 对齐；也可以删除本地 `linux/lib`，改用 `TTS_LINUX_SDK_DIR` 指向外部 SDK 动态库目录。

默认接口与 Wine TTS 一致：`POST /api/tts`、`GET /api/voices`、`GET /api/tts/status`。

Linux TTS 已使用以上独立二进制、模型、SDK 路径和 `../wine/runtime/prefix`，不依赖旧适配器目录。
