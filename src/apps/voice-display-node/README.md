# Node 语音子显示端

本程序通过 WebSocket 连接 AASC 服务端，独立提供语音输入与 TTS 播放，也可启用常驻 mpv 播放控制端媒体。支持Linux/Windows独立命令配置、Linux DISPLAY/XAUTHORITY、旋转及六种画面填充；TTS继续使用原Windows PowerShell/Linux aplay播放器。配置和使用见[常驻mpv播放说明](../../../docs/usage/node-display-mpv.md)。

Offline 发布时使用单独的 `voice-display-node-vN.zip`；它不会随服务热更新自动下载或安装。

## 解压与启动

将 ZIP 解压到项目根目录，保留 `src/apps/voice-display-node/` 和 `src/framework/observability/` 路径。该包已包含应用级依赖，不需要再运行 `npm install`。

Windows 可在 `src/apps/voice-display-node/` 目录运行 `start.bat`。也可在项目根目录执行：

```text
node src/apps/voice-display-node/main.js src/apps/voice-display-node/config.json
```

发布 ZIP 不含本机 `config.json`。手工独立运行前，将 `config.example.json` 复制为 `config.json`，再把 `serverUrl` 改为 AASC 服务地址；服务端自身启动时仍会按现有路径生成并维护该配置。

Node 原生依赖与生成 ZIP 的出包平台一致；当前发布目录面向 Windows x64 子显示设备。
