# Balabolka TTS Web Server

基于 Node.js 和 Balabolka 命令行工具 本地文字转语音服务。

该项目提供了一个 Web 界面和 HTTP API，允许用户通过浏览器或程序调用本地 TTS 引擎生成语音。支持语音选择、语速调节，默认使用 Microsoft Xiaoxiao 语音。

## 功能特性

- **Web 界面**：简洁直观的操作界面，支持实时预览。
- **语音列表**：自动获取系统已安装的 SAPI 5 语音。
- **语速控制**：支持 -10 到 10 的语速调节滑块。
- **默认语音**：自动选中并默认使用 "Microsoft Xiaoxiao" (如已安装)。
- **API 接口**：提供标准的 RESTful API，方便其他程序调用。
- **低依赖**：仅需 Node.js 和 Balabolka Console，无需复杂的运行环境。

## Android 离线 TTS APK

`android-tts/` 是独立的 Android TTS 应用，内置 Xiaoxiao 模型，不依赖本服务和网络。构建 debug APK：

```bash
npm run build:android-tts
```

产物位于 `android-tts/app/build/outputs/apk/debug/app-debug.apk`，仅支持 arm64-v8a、Android 8.0+。

## Android 离线语音识别 APK

`android-asr/` 是独立的 SenseVoice 离线语音识别应用，内置模型，支持录音、选择音频、识别耗时和自动/大核/小核 CPU 模式：

```bash
npm run build:android-asr
```

产物位于 `android-asr/app/build/outputs/apk/debug/app-debug.apk`。启动应用后可显式开启 HTTP 服务，默认监听 `0.0.0.0:18080`：

```bash
curl -X POST -H 'Content-Type: audio/wav' --data-binary @sample.wav http://设备IP:18080/api/asr
curl http://设备IP:18080/health
```

HTTP 服务仅用于受信任局域网测试，APK 仅支持 arm64-v8a、Android 8.0+。

## 环境要求

- **操作系统**: Microsoft Windows 7/8/10/11
- **运行时**: Node.js (建议 v12.0.0 及以上)
- **TTS 引擎**: [Balabolka Command Line Utility (balcon.exe)](https://www.cross-plus-a.com/bconsole.htm)

## 安装步骤

### 1. 准备 Balabolka

1. 访问 [Balabolka 官网](https://www.cross-plus-a.com/bconsole.htm) 下载 `balcon.zip`。
2. 解压文件，并记住 `balcon.exe` 所在的完整路径（例如：`.\balcon\balcon.exe`）。

### 2. 准备项目

1. 将项目代码下载到本地。
2. 在项目根目录下打开命令行，安装依赖：

