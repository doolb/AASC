# Node 子显示端常驻 mpv 播放

## 需求与范围

用户已确认：现有控制端向 Node 子显示端发送视频、音频、图片，子显示端调用常驻 mpv；命令配置区分 Linux/Windows，Linux 可指定 DISPLAY/XAUTHORITY。支持四方向旋转和现有六种画面填充，媒体切换不反复启停进程。

本期实现单媒体及播放/暂停、进度、音量和清空。音视频循环播放，图片持续展示。批量播放列表、HTML、文本和网页专用功能未接入mpv。配置缺省关闭，旧配置继续提供语音功能。

## 实现方案

- `mpv-player.js` 管理进程、JSON IPC、命令回执、临时媒体和回收；`mpv-platform.js`选择平台命令并验证X11认证；`mpv-geometry.js`计算画面；`media-controller.js`适配AASC消息。均位于 `src/apps/voice-display-node/`。
- `mediaPlayer.enabled` 开关默认false。`linux.command/args/display/xauthority`与`windows.command/args`按系统选择，使用参数数组和shell=false启动，Windows路径含空格不需要额外引号。外部mpv由使用者安装，不增加npm生产依赖。
- Linux先验证显式/继承认证，再参考 `scripts/open-chromium-display0.js` 搜索临时目录与用户目录中的普通认证文件；显式认证无效时直接失败，验证需要xdpyinfo。显式DISPLAY移除继承的WAYLAND_DISPLAY，避免输出到错误会话。
- 首次需要媒体时启动idle/keep-open/force-window/fullscreen常驻mpv，Linux使用私有临时目录socket，Windows使用独立命名管道。loadfile替换媒体，stop清空保留进程；崩溃/IPC失效清理本实例资源，下次播放重建，退出Node时等待有界回收。
- 接入现有url/base64/media、control、restoreState.state与capabilitiesUpdated。可用性经有界版本探测，媒体执行等待权威能力；不建立HTTP配置端点。HTTP/HTTPS地址支持已有fallbackUrl，临时base64上限64MiB且只写入本实例目录，替换/清空/退出清理，Windows文件句柄短暂占用有限重试。
- 快速媒体切换采用代次与串行加载，清空取消旧请求；恢复期间的新媒体、清空、断线和能力关闭使旧恢复失效。命令回执使用本次correlationId；播放状态仅在状态/媒体类型改变时上报，普通进度约每秒一次，状态变化即时上报，尺寸变化复用canvasSize，避免每秒持久化播放状态。
- `server-app.js` 中 `updateVoiceDisplayConfig` 保留本机配置并补齐缺失默认值，仅更新服务器连接地址；坏JSON保留原文件并报错。

## 旋转与画面填充

复用现有rotate/fit/crop/dynamicFitConfig控制，支持0/90/180/270度及contain、cover、height、width、dynamic、crop。使用video-rotate和缩放/平移属性实时应用，不重启mpv。

几何计算与网页applyCrop保持一致，包含旋转轴交换、百分比裁剪、居中与高度/宽度模式的既有语义。decoder参数先处理文件自带方向，再叠加用户旋转，避免重复旋转。窗口/媒体尺寸改变重算；切换媒体、恢复状态和进程重建重放当前画面参数。纯音频记忆参数供下一个视觉媒体使用。

dynamic沿用过渡与停留参数，20Hz上限、逐次等待IPC且至多一个调度器；退出模式、清空、能力关闭、崩溃和退出均取消旧调度。

## TTS与并行音频

用户补充要求保留系统TTS命令。本期完整保留 `audio-player.js` 与TTS队列：Windows PowerShell SoundPlayer，Linux aplay。TTS开始/停止不调用mpv加载/停止，媒体清空不清空TTS队列，客户端退出分别关闭两者。

mpv强制audio-exclusive=no。两者同时发声仍依赖系统共享音频输出或ALSA混音配置，不自动修改系统音频设置。mpv可用lavfi-complex/amix同时混合音轨，本次不将临时TTS绑定到媒体时间轴。参考：[mpv官方手册](https://mpv.io/manual/stable/)。

## 需求评审与L4拆解

初始enterprise评审为可开发，主L6（播放器模块、平台配置和协议契约），次L5（进程/动态生命周期），直接开发风险中。证据：[L6|强]“暂时只支持mpv”；[L6|强]“配置支持linux和window两种”；[L5|中]“常驻，避免反复开启关闭”；[L6|弱]确认DISPLAY/XAUTHORITY及控制端触发。置信度7/9×0.90=0.70；评分23/25、20/20、16/20、18/20、14/15，共91/100。

建议下放，所需能力L6；已将平台选择、认证、初始化、IPC、切换、画面几何、状态恢复与资源回收拆到[对应L4伪代码](../spec/node-display-mpv.md)。初始断点是Node无媒体处理和服务端覆盖配置，分别由独立模块和配置保留解决。初始后续技能选项为ai-code-translation/project-pseudocode-sync/不调用其他技能；用户直接确认实施，未额外调用其他技能。

## 验证与发布边界

源码完成。自动测试覆盖IPC和进程、平台配置、恢复竞态、TTS独立性以及96组网页几何对照；本机真实mpv以null输出验证视频/音频/图片、PID保持、暂停/断点、旋转、清空和回收。语音/重连与独立包回归通过，精确结果见self-test/changelog。

Linux真实屏幕/X11认证、Windows实机图形/管道及双路声音实际混音待设备验收，不以null输出或模拟验证替代。voiceDisplayNodePackage=true、servicePackage=true；其他产物状态保留，未构建或发布本轮独立包。
