# Linux TTS 实现文档

> 使用伪代码描述，与 `3rd/tts-server/tts-linux.js` 和 `3rd/tts-server/linux/` 同步。

## 模块位置

- `3rd/tts-server/tts-linux.js`：HTTP 服务、队列、子进程调用和错误处理。
- `3rd/tts-server/linux/CMakeLists.txt`：独立 Linux CLI 构建入口。
- `3rd/tts-server/linux/src/tts_linux.cpp`：Embedded Speech SDK 合成 CLI。

## 配置伪代码

```text
resolveLinuxRuntimeConfig(environment):
    binaryPath = environment.TTS_LINUX_BIN 或 3rd/tts-server/linux/bin/tts_linux
    modelPath = environment.TTS_LINUX_MODEL_DIR 或 3rd/tts-server/linux/models/extracted
    license = "Key:ZCjZ7nHDSLvf4gpELteM4AnzaWUjTpn7UkV7D@vvksl0w1SNgon6d1905WANbktDc9S39oaA4r29HJNayXvTq8fJsq"
    defaultVoice = environment.TTS_DEFAULT_VOICE 或 "Microsoft Xiaoxiao"
    workerCount = environment.TTS_LINUX_WORKERS 或 1
    maxQueue = environment.TTS_LINUX_MAX_QUEUE 或 16
    timeout = environment.TTS_LINUX_TIMEOUT_MS 或 300000
    返回配置
```

## HTTP 伪代码

```text
POST /api/tts:
    读取 text, voice, speed
    如果 text 为空白:
        返回 400 JSON 错误
    如果队列已满:
        返回 503 JSON 错误
    将请求加入 FIFO 队列
    调度空闲执行槽

执行 TTS 请求:
    创建临时输出 wav 路径
    启动 tts_linux --model --text --out --voice --license
    在 timeout 内等待进程退出
    如果客户端已断开:
        终止/忽略子进程结果并清理 wav
    如果进程失败或输出文件不存在:
        返回 500 JSON 错误并清理 wav
    读取 WAV
    返回 Content-Type=audio/wav
    finally:
        删除临时 wav
        释放执行槽并继续调度

GET /api/voices:
    返回配置的默认语音列表

GET /api/tts/status:
    返回 queueLength、activeWorkers、workerCount、maxQueueLength、timeout
```

## Linux CLI 伪代码

```text
main:
    解析 model/text/out/voice/license 参数
    config = EmbeddedSpeechConfig.FromPath(model)
    config.SetSpeechSynthesisOutputFormat(Riff24Khz16BitMonoPcm)
    如果 voice 为空:
        从模型目录探测第一个可用语音
    config.SetSpeechSynthesisVoice(voice, license)
    synthesizer = SpeechSynthesizer.FromConfig(config, 无音频输出流)
    result = synthesizer.SpeakTextAsync(text).等待
    如果 result 为 SynthesizingAudioCompleted:
        写入 result.GetAudioData() 到 out
        返回 0
    打印 cancellation details
    返回 1
```

## 删除旧适配器后的路径规则

```text
正式服务启动:
    只解析 TTS_LINUX_BIN/TTS_LINUX_MODEL_DIR/TTS_LINUX_SDK_DIR
    授权串固定使用运行时入口中的硬编码值，不读取 TTS_LINUX_LICENSE/MS_TTS_KEY
    不拼接 NaturalVoiceSAPIAdapter 路径

构建 CLI:
    禁止把构建机 SDK 绝对路径写入 RUNPATH
    运行时通过 TTS_LINUX_SDK_DIR 或同目录 lib 提供 SDK 动态库
    cmake --install --prefix 3rd/tts-server/linux:
        安装 tts_linux 到 linux/bin
        安装 x64 SDK 动态库到 linux/lib
```

## 运行时准备脚本伪代码

prepareRuntime(options):
    archiveDir = options.sdkArchiveDir 或 3rd/tts-server/sdk-archives
    linuxSdkArchive = archiveDir/SpeechSDK-Embedded-Linux-{version}.tar.gz
    如果 linuxSdkArchive 不存在:
        从 options.linuxSdkUrl 或官方 Linux Embedded SDK 地址下载到 linuxSdkArchive
    校验 linuxSdkArchive 的 SHA256（如果提供）
    如果 linuxSdkDir 缺少关键文件:
        解压 linuxSdkArchive 到临时 staging 目录
        校验 staging 目录结构
        将 staging 目录移动为 linuxSdkDir
    winePackages = archiveDir 下的 Speech/Embedded.TTS/ONNX.Runtime/Telemetry 指定版本 NuGet 包
    对每个 winePackage:
        不存在则下载到 archiveDir，存在则复用并校验
        如果对应 wineSdkDir 缺少关键文件:
            解压到临时 staging 目录并校验结构
            将 staging 目录移动为对应组件目录
    wineRuntime = 复制四个包的 win-x64/native DLL 到 options.wineBinDir
    如果 options.winePrefix 不存在关键注册表文件:
        执行 WINEARCH=win64 WINEPREFIX=options.winePrefix wineboot --init
    如果未指定 prepare-only:
        编译 Linux CLI 和 Wine worker
    如果未指定 skip-test:
        执行 Linux WAV 合成测试
        执行 Wine WAV 合成测试
    返回每个阶段的成功、跳过或环境限制状态

下载规则:
    使用 curl -fL 下载到 archiveDir/*.part
    下载完成后移动为 archiveDir 中的原始压缩包，构建完成后不删除
    下载完成后优先校验对应 SHA256 环境变量
    校验和不匹配或解压结构缺失 -> 失败且不覆盖现有目标
    archiveDir 中的原始压缩包由普通 Git 提交，不使用 Git LFS
```
