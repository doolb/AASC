# Linux TTS 实现伪代码

```text
启动:
  读取 TTS_LINUX_BIN/TTS_LINUX_MODEL_DIR/TTS_LINUX_SDK_DIR
  授权串固定为与 APK/Wine 相同的硬编码值，不读取 TTS_LINUX_LICENSE/MS_TTS_KEY
  默认构建 SDK 位于 linux/sdk，运行时 SDK 通过 TTS_LINUX_SDK_DIR 注入
  创建 Express HTTP 服务
  创建有界 FIFO 队列

POST /api/tts:
  校验 text 非空
  队列满 -> 返回 503
  加入队列并调度空闲执行槽

执行任务:
  创建临时目录和 speech.wav
  启动 tts_linux --model --text --out --voice --license --speed
  超时或进程失败 -> 返回结构化错误
  成功 -> 返回 audio/wav
  finally -> 删除临时目录，释放执行槽，继续调度

GET /api/voices:
  返回默认语音列表

GET /api/tts/status:
  返回 queueLength、activeWorkers、workerCount、maxQueueLength、timeoutMs
```

```text
tts_linux:
  EmbeddedSpeechConfig.FromPath(model)
  设置 Riff24Khz16BitMonoPcm
  探测或设置 voice，并注入 license
  speed=0 -> SpeakTextAsync(text)
  speed!=0 -> SpeakSsmlAsync(prosody rate)
  成功 -> 写入 WAV

Linux CLI 安装:
  cmake --install --prefix 3rd/tts-server/linux
  tts_linux -> linux/bin
  SDK x64 动态库 -> linux/lib，与 `$ORIGIN/../lib` RUNPATH 对齐

tts_wine:
  默认 Wine prefix = 3rd/tts-server/wine/runtime/prefix
  启动 worker 时使用与 Linux/APK 相同的硬编码授权值

prepare-runtime.sh:
  将 Linux Embedded SDK 与 Wine NuGet SDK 原始压缩包下载并校验到 sdk-archives
  保留 sdk-archives 中的压缩包，供普通 Git 直接提交
  归档已存在时跳过网络下载并直接复用
  解压到独立 runtime 目录
  目标 prefix 缺失时执行 wineboot --init
  编译 Linux CLI/Wine worker
  将 Wine 四个 win-x64/native DLL 部署到 WINE_BIN_DIR
  分别执行 Linux/Wine WAV 测试并输出环境限制
```
