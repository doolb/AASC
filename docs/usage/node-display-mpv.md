# Node 子显示端：常驻 mpv 媒体播放

Node 子显示端可接收现有控制端发送的图片、视频和音频；媒体能力获服务端确认开启后启动一个 mpv 进程并显示ASS信息层，此后通过 IPC 切换媒体。清空媒体保留进程与空窗口，退出子显示端时关闭自己的 mpv。此功能需要部署本轮新版 Node 子显示端；独立发布包仍待构建。

## 配置和启动

先在目标机器安装 mpv。Linux 使用 X11 时还需 `xdpyinfo`（通常由发行版的 X11 工具包提供），并使用拥有该图形会话访问权限的账号运行。

修改 `src/apps/voice-display-node/config.json`，参考以下配置；`linux` 和 `windows` 按当前系统自动选择：

```json
{
  "serverUrl": "http://127.0.0.1:3000",
  "mediaPlayer": {
    "enabled": true,
    "linux": {
      "command": "mpv",
      "args": [],
      "display": ":0",
      "xauthority": "/home/your-user/.Xauthority"
    },
    "windows": {
      "command": "C:\\Program Files\\mpv\\mpv.exe",
      "args": []
    }
  }
}
```

Linux 的 `display` 是图形会话 `DISPLAY`，与 AASC 的显示端 ID 无关。`xauthority` 需改成实际认证文件；留空时先尝试当前环境，再参考 `open-chromium-display0.js` 搜索临时目录及用户目录中的 `.Xauthority` / `xauth_*`。显式指定的认证无效时直接报告错误，不自动切换为其他认证。省略 `display` 时继承环境会话；显式指定 X11 会话时不使用继承的 Wayland 会话。

命令配置必须是单个可执行文件路径，参数放进 `args` 数组；含空格的 Windows 路径无需额外加引号，不支持把 shell 命令串写进 `command`。针对自签名 HTTPS 媒体源，可按实际部署情况自行配置 mpv 的 TLS 参数；默认沿用 mpv 校验行为。

使用现有应用启动脚本：

```bash
npm --prefix src/apps/voice-display-node run start -- config.json
```

该命令中的相对配置路径以子显示端目录为基准，也可传入配置文件绝对路径。需要完整默认示例时先复制同目录 `config.example.json`。默认 `mediaPlayer.enabled=false`；不开启或 mpv 不可用时保留语音功能，不声明可用媒体能力。服务端更新连接地址时保留本机播放器与录音设置。

配置文件必须存在、JSON合法且包含明确的HTTP/HTTPS `serverUrl`。配置错误时，程序会在终端直接输出 `[ERROR][配置]`、绝对文件路径、失败阶段和具体原因，退出码为1；此时不会初始化TUI、录音或服务器连接，也不回退到localhost。Windows运行 `start.bat` 会在失败时暂停窗口以保留错误；修正配置后重新启动。

## 控制端操作

在控制端选中该 Node 显示端，按既有方式发送单个 URL 媒体或临时上传文件。视频、音频循环播放，图片持续展示；支持播放/暂停、进度、音量及清空。临时文件写入本实例临时目录，上限64MiB，替换/清空/退出时回收；媒体 URL 支持 HTTP/HTTPS及相对服务地址，直连失败时尝试已有代理回退地址。

图片与视频支持0°、90°、180°、270°旋转，以及适应、铺满、高度铺满、宽度铺满、动态和裁剪。沿用既有控制端按钮、裁剪百分比、动态过渡与停留时间；高度/宽度模式与网页显示端保持相同旋转语义。旋转或填充不会重启 mpv；媒体切换继续使用当前画面设置。重连后恢复服务器保存的媒体、暂停状态、播放位置和画面设置。

适应使用原生 `panscan=0`，铺满使用 `panscan=1`，动态在0与1之间渐变。高度/宽度按比例和旋转选择原生适应或铺满；自定义裁剪继续按百分比设置。切换模式会清除旧缩放和平移，避免叠加；原生适应/铺满/动态不必等待媒体或窗口尺寸就绪。程序保持keepaspect开启、video-unscaled关闭，旧mpv缺少可选scale复位属性时也可使用原生模式。

当前支持单媒体；批量播放列表、HTML、文本与网页专用画面功能尚未接入 mpv。纯音频只记忆画面参数，下一张图片或视频加载时应用。

### 裁剪与移动

在控制端选择目标Node显示端，播放图片或视频后切换“裁剪”模式。拖动预览中的裁剪框可移动可见区域，拖动边缘手柄可缩放；也可输入X/Y/宽度/高度百分比后应用。四方向旋转均支持，裁剪框所在区域会放大显示。

裁剪使用mpv的 `video-zoom` 和 `video-pan-x/y`，无需额外配置，不重新开启播放器。连续拖动会合并中间请求并应用最后位置；切回适应或铺满会清除缩放、偏移。重连继续沿用服务端已有fit/crop状态。Linux实际画面已验证，Windows协议兼容测试通过，实际画面仍需现场核对。

## ASS信息显示

开启本机mediaPlayer并由控制端启用该显示端的媒体能力后，信息层自动显示，无需新增配置。没有媒体时使用黑底窗口；视频暂停、纯音频、清空媒体或断网时继续显示本机时钟和状态。退出Node时关闭自己的播放器。

位置按网页版最终布局：正常方向时间在右上、连接提示在左上，TTS在顶部居中，ASR在底部居中并保留网页语音按钮上方的位置；旋转时沿用网页四方向锚点和边距。裁剪/填充不移动或放大信息层。控制端既有“状态栏”开关只隐藏连接提示，时间与文字继续显示。

TTS文字随本机PowerShell/aplay实际开始播放的队列条目切换，不在收到下一条音频时提前显示；最后一条播放完成保留30秒，停止/失败清除。ASR成功与有文字的忽略结果按原声纹格式回显，30秒隐藏，新结果重置计时。正文最多2048字符，TTS最多三行；本版按条目显示，不提供网页字幕历史或精确逐字进度。系统需有可显示中文的字体，ASS会使用系统字体回退。

布局已对照普通桌面网页、相同窗口尺寸和100%缩放，并完成Linux实际画面验证；Windows设备的实际字体及DPI效果仍需现场核对。mpv不支持ASS OSD时记录错误，媒体和系统TTS仍按原链路工作。

## TTS 与媒体音频

TTS继续使用原 `audio-player.js` 播放队列：Windows调用 PowerShell `SoundPlayer`，Linux调用 `aplay`。TTS不加入常驻mpv；停止TTS不会停止媒体，清空媒体也不会清空TTS队列。TTS沿用原队列串行播放行为。

mpv通过 `--audio-exclusive=no` 使用非独占模式。媒体音频与TTS能否同时发声依赖系统共享音频输出：Windows系统混音、Linux PulseAudio/PipeWire或ALSA混音配置；如果本机把输出设备配置成独占硬件设备，仍需调整本机音频配置。项目不自动改系统音频设置。mpv自身可用lavfi/amix混合音轨，本次不将临时TTS接入该时间轴。

## 自测

```bash
npm run test:node-display-mpv
npm run test:node-display-mpv:real
npm run test:node-display-config
npm run test:node-display-mpv:render
npm run test:node-display-mpv:layout
```

第一项验证跨平台配置与 IPC 协议、生命周期、AASC接入和96组网页几何对照，不要求安装mpv。第二项要求安装mpv和ffmpeg，真实播放生成的视频/音频/图片，使用null输出，不打开桌面或发声；不能替代Linux真实画面、Windows实机或双路声音混音验收。

配置测试验证真实失败进程的ERROR与退出码，以及启动前零业务依赖加载。render测试另外需要Linux Xvnc/xdpyinfo/ffmpeg/mpv，在隔离显示屏中检查四方向适应黑边、铺满及裁剪横纵移动像素，并检查真实视频的两个裁剪位置；不访问现有桌面，该测试不替代Windows实机验收。

layout测试另外需要Chromium/puppeteer，在临时本机静态网页中对照两个窗口与四个旋转方向，不连接用户服务。render覆盖ASS空闲/视频暂停/纯音频/清空/移除、中文回显及原填充裁剪；不替代Windows实机验收。
