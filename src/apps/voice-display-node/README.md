# Node 语音子显示端

本程序通过 WebSocket 连接 AASC 服务端，独立提供语音输入与 TTS 播放，也可启用常驻 mpv 播放控制端媒体。支持Linux/Windows独立命令配置、Linux DISPLAY/XAUTHORITY、旋转及六种画面填充；TTS继续使用原Windows PowerShell/Linux aplay播放器。媒体能力开启后自动以ASS显示时间、连接状态、当前TTS文字及ASR回显，位置沿用网页版四方向布局；无媒体也保留信息层。配置和使用见[常驻mpv播放说明](../../../docs/usage/node-display-mpv.md)。

Offline 发布时使用单独的 `voice-display-node-vN.zip`；它不会随服务热更新自动下载或安装。

## 解压与启动

将 ZIP 解压到项目根目录，保留 `src/apps/voice-display-node/` 和 `src/framework/observability/` 路径。该包已包含应用级依赖，不需要再运行 `npm install`。

Windows 可在 `src/apps/voice-display-node/` 目录运行 `start.bat`。也可在项目根目录执行：

```text
node src/apps/voice-display-node/main.js src/apps/voice-display-node/config.json
```

发布 ZIP 不含本机 `config.json`。手工独立运行前，将 `config.example.json` 复制为 `config.json`，再把 `serverUrl` 改为 AASC 服务地址；服务端自身启动时仍会按现有路径生成并维护该配置。

`config.example.json` 包含当前支持的全部本机配置项。中文注释集中在 `_comments` 字段，文件保持标准 JSON，可直接复制使用；不要添加 `//` 或块注释。示例涵盖 VAD、录音模式、播放期间录音策略、系统文字输入声纹、Linux TTS输出设备和 Linux/Windows mpv 参数。显示端 ID 自动取 hostname；主题、能力、旋转等继续通过控制端配置。媒体默认关闭，Linux 默认继承 DISPLAY/XAUTHORITY，Windows 默认从 PATH 查找 mpv.exe。

配置错误会在初始化界面和网络前直接输出 `[ERROR][配置]`、文件路径及原因，并以退出码1停止；Windows `start.bat` 失败时会暂停显示错误。配置必须包含明确的HTTP/HTTPS服务器地址，不再回退localhost。适应/铺满/动态填充现使用mpv原生panscan。

Node 原生依赖与生成 ZIP 的出包平台一致；当前发布目录面向 Windows x64 子显示设备。

Linux TTS默认自动选择可达的pulse/pipewire共享PCM，无可用入口时沿用default；可通过本机 `audioPlayer.linux.device` 显式指定ALSA设备。设备选择按实例缓存，修改后重启；mpv与TTS的音频会话要求见上方播放说明。

## 睡眠模式

使用控制端已有睡眠时段、立即睡眠/深睡和临时激活按钮。普通睡眠暂停并遮黑媒体与正文，保留时钟等UI；深睡全黑。临时激活60秒，新下发媒体会激活，重连恢复不激活。唤醒按原播放意图恢复，手动暂停保持暂停；正文句子暂挂，通用TTS、录音和连接继续。未收到服务器配置前默认关闭睡眠，断线后沿最后设置，退出清理计时器。需更新服务包与Node独立包；Linux真实mpv已验证，Windows实机待验。
