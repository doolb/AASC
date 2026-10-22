# Node 子显示端常驻 mpv 播放

## 需求与范围

用户已确认：现有控制端向 Node 子显示端发送视频、音频、图片，子显示端调用常驻 mpv；命令配置区分 Linux/Windows，Linux 可指定 DISPLAY/XAUTHORITY。支持四方向旋转和现有六种画面填充，媒体切换不反复启停进程。

本期实现单媒体及播放/暂停、进度、音量和清空。音视频循环播放，图片持续展示。批量播放列表、HTML、文本和网页专用功能未接入mpv。配置缺省关闭，旧配置继续提供语音功能。

2026-10-22按用户要求修复当前本机config.json缺失最外层闭合括号，并开启mediaPlayer；保留已配置服务地址 `https://192.168.1.39:8081` 及平台命令。此为本机配置调整，不改变示例/程序的默认关闭策略；Windows重启后连接与播放仍需现场验收。

## 实现方案

### 配置错误显式报错（2026-10-22，已实现）

用户指出“配置错误应该给个error”。修复前loadConfig：读取/JSON解析异常只进入TUI日志，随后返回含localhost的默认配置，造成连接错误服务器的表象。现将文件缺失/不可读、JSON语法错误、根节点非对象和serverUrl缺失/非HTTP(S)地址视为启动失败：显示ERROR、绝对配置路径与具体原因，在TUI/网络/录音模块加载之前同步写终端stderr并以非零状态退出，不建立WebSocket或启动播放器。配置正确时继续复用原可选字段默认值。

已修改main.js的loadConfig与启动前检查，start.bat在自身目录调用npm start并在失败时暂停、保留退出码。新增配置自测4/4通过，真实失败进程验证在TUI/网络/录音/播放器依赖加载前输出ERROR并退出1；Windows批处理已核对契约，双击可见性待实机。

需求评审（enterprise）：主L5（失败退出而非继续连接），次L6（配置契约），结论可开发、风险低，建议下放到L4。证据为用户的明确报错要求、当前catch返回默认配置、TUI日志未阻止启动三项；主等级证据权重6/8×邻层一致性0.90=0.675。评分25/25、20/20、18/20、18/20、15/15，共96/100。拆解为读取/校验→错误归因→终端输出→退出码与资源收尾；主要风险为现有缺少serverUrl的旧配置由默认连接变为显式失败，以错误说明和测试覆盖。

L4草案见对应spec。初始后续技能选项为ai-code-translation、project-pseudocode-sync或仅保留分析；用户已确认本轮实施，未自动调用其他技能。

- `mpv-player.js` 管理进程、JSON IPC、命令回执、临时媒体和回收；`mpv-platform.js`选择平台命令并验证X11认证；`mpv-geometry.js`计算画面；`media-controller.js`适配AASC消息。均位于 `src/apps/voice-display-node/`。
- `mediaPlayer.enabled` 开关默认false。`linux.command/args/display/xauthority`与`windows.command/args`按系统选择，使用参数数组和shell=false启动，Windows路径含空格不需要额外引号。外部mpv由使用者安装，不增加npm生产依赖。
- Linux先验证显式/继承认证，再参考 `scripts/open-chromium-display0.js` 搜索临时目录与用户目录中的普通认证文件；显式认证无效时直接失败，验证需要xdpyinfo。显式DISPLAY移除继承的WAYLAND_DISPLAY，避免输出到错误会话。
- 首次需要媒体时启动idle/keep-open/force-window/fullscreen常驻mpv，Linux使用私有临时目录socket，Windows使用独立命名管道。loadfile替换媒体，stop清空保留进程；崩溃/IPC失效清理本实例资源，下次播放重建，退出Node时等待有界回收。
- 接入现有url/base64/media、control、restoreState.state与capabilitiesUpdated。可用性经有界版本探测，媒体执行等待权威能力；不建立HTTP配置端点。HTTP/HTTPS地址支持已有fallbackUrl，临时base64上限64MiB且只写入本实例目录，替换/清空/退出清理，Windows文件句柄短暂占用有限重试。
- 快速媒体切换采用代次与串行加载，清空取消旧请求；恢复期间的新媒体、清空、断线和能力关闭使旧恢复失效。命令回执使用本次correlationId；播放状态仅在状态/媒体类型改变时上报，普通进度约每秒一次，状态变化即时上报，尺寸变化复用canvasSize，避免每秒持久化播放状态。
- `server-app.js` 中 `updateVoiceDisplayConfig` 保留本机配置并补齐缺失默认值，仅更新服务器连接地址；坏JSON保留原文件并报错。

## 旋转与画面填充

### 改用原生panscan（2026-10-22，已实现）

用户反馈画面填充无效，并提出使用panscan。修复前applyGeometry固定panscan=0，contain/cover/动态等依赖decoder/window尺寸和video-scale-x/y；这说明旧实现路径，不能据此认定Windows现场失败的唯一原因。此前数值/IPC/null输出测试不等同真实画面通过。

mpv-player.js现实现：contain用panscan=0，cover用panscan=1，dynamic在0/1间渐变，切换时统一清除残留video-zoom、video-scale-x/y、video-pan-x/y，确保keepaspect开启、video-unscaled关闭。原生三模式无需媒体尺寸也可下发控制，随窗口尺寸由mpv适配。height/width按文件方向、用户旋转及窗口比例选0或1，保持原方向语义；crop仍使用已有几何矩形并先归零panscan，不能仅凭panscan表达自定义裁剪位置。

已补充专项17/17、真实mpv null输出1/1、隔离Xvnc真实画面1/1。旧版mpv不存在可选scale属性时跳过复位，不阻断原生panscan；crop仍要求其几何属性可用。已核对实际IPC值、动态中间值、裁剪切换、四方向/比例、PID和TTS。Node独立包待打包状态保持true，本轮未构建发布。官方约束：panscan在video-unscaled开启时无效，部分输出驱动支持有差异，需目标Windows实机核对。

enterprise评审：主L6（填充模式与mpv属性映射），次L5（动态状态与清理），结论可开发、风险中，建议拆到L4。证据为用户“画面填充无效”、用户指定“panscan方式”、代码固定panscan=0；主等级权重6/8×0.90=0.675。评分24/25、20/20、17/20、18/20、15/15，共94/100。将状态复位、模式映射、比例选择、原生插值和回执校验拆为对应spec伪代码；不将模拟回执成功记为实际画面修复。

后续技能选项为ai-code-translation、project-pseudocode-sync或仅保留分析；本轮不自动调用其他技能。配置错误显式ERROR与panscan修复均经用户确认并完成实现。

复用现有rotate/fit/crop/dynamicFitConfig控制，支持0/90/180/270度及contain、cover、height、width、dynamic、crop。使用video-rotate与原生panscan实时应用，crop保留缩放/平移，不重启mpv。

几何计算与网页applyCrop保持一致，包含旋转轴交换、百分比裁剪、居中与高度/宽度模式的既有语义。decoder参数先处理文件自带方向，再叠加用户旋转，避免重复旋转。窗口/媒体尺寸改变重算；切换媒体、恢复状态和进程重建重放当前画面参数。纯音频记忆参数供下一个视觉媒体使用。

dynamic以原生panscan在0与1间插值，沿用过渡与停留参数，20Hz上限、逐次等待IPC且至多一个调度器；退出模式、清空、能力关闭、崩溃和退出均取消旧调度。

## TTS与并行音频

用户补充要求保留系统TTS命令。本期完整保留 `audio-player.js` 与TTS队列：Windows PowerShell SoundPlayer，Linux aplay。TTS开始/停止不调用mpv加载/停止，媒体清空不清空TTS队列，客户端退出分别关闭两者。

mpv强制audio-exclusive=no。两者同时发声仍依赖系统共享音频输出或ALSA混音配置，不自动修改系统音频设置。mpv可用lavfi-complex/amix同时混合音轨，本次不将临时TTS绑定到媒体时间轴。参考：[mpv官方手册](https://mpv.io/manual/stable/)。

## 需求评审与L4拆解

初始enterprise评审为可开发，主L6（播放器模块、平台配置和协议契约），次L5（进程/动态生命周期），直接开发风险中。证据：[L6|强]“暂时只支持mpv”；[L6|强]“配置支持linux和window两种”；[L5|中]“常驻，避免反复开启关闭”；[L6|弱]确认DISPLAY/XAUTHORITY及控制端触发。置信度7/9×0.90=0.70；评分23/25、20/20、16/20、18/20、14/15，共91/100。

建议下放，所需能力L6；已将平台选择、认证、初始化、IPC、切换、画面几何、状态恢复与资源回收拆到[对应L4伪代码](../spec/node-display-mpv.md)。初始断点是Node无媒体处理和服务端覆盖配置，分别由独立模块和配置保留解决。初始后续技能选项为ai-code-translation/project-pseudocode-sync/不调用其他技能；用户直接确认实施，未额外调用其他技能。

## 验证与发布边界

源码完成。自动测试覆盖IPC和进程、平台配置、恢复竞态、TTS独立性以及96组网页几何对照；本机真实mpv以null输出验证视频/音频/图片、PID保持、暂停/断点、旋转、清空和回收。语音/重连与独立包回归通过，精确结果见self-test/changelog。

隔离Linux Xvnc四方向实屏像素验证通过：contain边缘[0,0,0]，cover同位置[0,255,0]，常驻PID保持；未访问用户桌面或开放VNC/TCP端口。目标图形会话认证、Windows实机/双击错误可见性与双路声音混音仍待验收。voiceDisplayNodePackage=true、servicePackage=true；其他产物状态保留，未构建或发布本轮独立包。

## 裁剪移动追加需求（2026-10-22，已实现）

用户要求“再支持下裁剪移动”，已确认并完成复用控制端裁剪框拖动、缩放及X/Y/宽高输入，实时移动mpv的视频或图片可见区域，支持四方向旋转，保持常驻进程。

已核实现有crop消息包含百分比x/y/width/height，控制端拖动直接更新视觉坐标；服务端持久化crop，已有fit切换与restoreState，无需新增配置接口。排查时Node已有裁剪几何但移动未经实屏验收，旧writeGeometry依赖video-scale-x/y且连续拖动反复归零；本次替换属性路径并补充独立裁剪实屏验证。

已修改mpv-player.js：将既有等比裁剪几何换算为video-zoom与video-pan-x/y，居中对齐后直接应用最终值，移动前不归零；复用既有mpv-geometry.js，无需改动几何算法。连续输入与尺寸事件共用串行任务，合并到最新状态，切换媒体/模式后取消旧更新。保留原生panscan填充、现有状态恢复及独立TTS。

enterprise评审结论可开发，主L6播放器输入/输出契约、次L5连续更新生命周期，直接实现风险中。[L6|强]“支持下裁剪移动”；[L6|强]用户确认裁剪框/四方向/zoom与pan方案；[L5|中]确认合并连续拖动及保持常驻。置信度6/8×0.90=0.675；评分24/25、20/20、17/20、18/20、15/15，合计94/100。建议下放，所需能力L6，已将坐标、属性转换、单任务合并与生命周期拆为对应spec的L4流程；保留分析结果，不额外调用翻译或伪代码技能。验收要求为画面可见位置随裁剪框变化、最后一次拖动生效、四方向一致、PID不变及恢复原生填充后无残留偏移。

属性依据：[mpv官方手册](https://mpv.io/manual/stable/)规定zoom为以2为底的缩放指数，pan单位为完整已缩放视频尺寸的比例；据此换算几何并以实屏验证，不依赖旧版本可能缺失的video-scale-x/y实现放大。

验证完成：专项21/21、真实mpv IPC 1/1、隔离Linux真实画面2/2、独立包22/22，共46项、零跳过。真实画面包含四方向16组图像位置与2组视频位置，中心像素符合独立坐标逆变换，缩放减半、原生填充复位与常驻PID通过；200次在途拖动输入合并为少于20次属性写入。Linux/Windows协议与无scale兼容均覆盖，Windows实机仍待验收。voiceDisplayNodePackage保持true，其余状态不变，未构建或发布独立包。

## ASS信息叠加（2026-10-22，已实现）

用户要求用ASS字幕显示现有网页的时间、连接状态、TTS播放文字与ASR识别回显。已参照网页信息布局：右上本地HH:mm:ss每秒刷新，左上当前Node的连接中/已连接/断开或错误，TTS使用网页最终的顶部居中布局，ASR位于底部语音按钮区域上方；文字按中文宽度换行，并适配窗口和四方向逻辑布局，不受视频裁剪/缩放影响。并非抓取网页DOM，而是复用本端已有同源运行状态。

已核实网页ASR默认30秒隐藏、TTS有播放进度及字幕历史，Node已有formatAsrDisplayText和识别成功/ignored两路回显，但AudioPlayer队列只保留URL/Buffer与完成回调，且onPlayStart/onPlayEnd是录音模式使用的整队列回调。已添加独立逐条播放通知与文字元数据，不覆盖原录音回调；当前条目开始时显示文字，下一条替换，停止/失败清除，播完最后一条暂留30秒。ASR新文本重置30秒计时，不将忽略结果转发为新的用户输入。本期按条目显示，精确逐字对齐或复制网页历史滚动不作为本次承诺。

已新增mpv-overlay.js管理信息状态、ASS文本、布局和隐藏计时；在mpv-player.js通过同一常驻IPC的osd-overlay/ass-events叠加。main.js与media-controller.js接入时钟/连接事件、TTS/ASR和已有displayStatusBarConfig开关（只隐藏连接提示，不隐藏时钟/正文）。默认媒体能力获服务端确认开启后启动黑底空闲窗口，即使没有视频/图片也可显示这些信息；暂停、纯音频、清空媒体、断网和切换媒体时保持信息层；能力关闭移除信息层并停止刷新，退出时回收自有播放器。崩溃不以1Hz时钟无限重启，后续有效启动重放最新快照。

只使用现有AASC/WebSocket数据及状态栏配置，不增加HTTP配置接口、独立字幕服务或通用文本媒体能力声明。TTS声音仍走PowerShell/aplay，mpv只显示文字。已修改main.js、media-controller.js、mpv-player.js、audio-player.js，新增overlay模块与专项/真实画面用例、网页浏览器位置对照入口，更新使用/自测文档。

enterprise评审：主L6（ASS渲染模块及四类信息输入契约）、次L5（逐条播放/隐藏计时/会话生命周期），建议下放、能力L6、直接实现风险中，结论可开发。[L6|强]“用ass字幕显示”；[L6|强]“时间,连接状态,tts播放文字,asr识别回显示”；[L5|中]“tts播放文字”需要随实际播放切换。置信度6/8×0.90=0.675；评分24/25、20/20、17/20、18/20、15/15，共94/100。风险是媒体时间轴暂停导致静态字幕失效、队列提前到达显示错句、旧回调清除新字幕、ASS控制字符和中文字体、布局旋转与裁剪耦合；已用OSD叠加、条目代次、单调度器、转义和实屏检查处理。L4草案见对应spec，后续保留分析结果，不额外调用其他技能。

依据：[mpv官方osd-overlay说明](https://mpv.io/manual/stable/#command-interface-osd-overlay)支持ASS事件且不依赖字幕事件时间，叠加层随其IPC连接销毁，需在重建后重放。用户进一步要求“位置要和网页版一样”，按此约束继续实施已有具体文件方案；不再采用先前概括的下方TTS分区。

位置基准以display.html最终applyVoiceTopCenterLayout/applyVoiceCenteredAnchor为准，不能只读取applyRotation中的初始bottom位置。普通浏览器100%缩放：0度TTS顶部160px；180度沿用网页bottom-center变换原点，逻辑盒子起点为160减盒高（例如800×600时物理top=440）；90/270度最终边缘使用自适应edgeMargin。时间与连接提示固定20px边缘，物理视口宽度不大于768时字号沿用网页32/12px，否则48/16px。ASR沿用display-voice-action-group底部70px及按钮/状态/间距占位，在底部居中上方，保留网页未绘制按钮的布局空间。Node没有WebView初始缩放、软键盘或原生安全区，采用网页普通桌面默认值；以浏览器执行真实布局函数及CSS的结果作位置回归，不改网页生产代码。

完成验证：mpv专项27/27（含信息状态、系统音频逐条通知、真实main ASR回调/状态栏、初始化恢复竞态）、真实浏览器布局1/1（横竖窗口四旋转共8组，TTS盒边/时间及连接锚点误差小于2px、ASR底部中心小于3px）、隔离Xvnc实屏3/3、真实mpv IPC 1/1、独立包22/22、语音/重连与Windows输入22/22，合计76项、零跳过。实屏验证中文TTS/ASR对应区域的亮像素来自文字本身、四旋转与裁剪、视频暂停时钟像素418处变化、纯音频/清空/移除与PID保持；ASS转义与mpv escape-ass一致。

首次网页对照发现180度最终位置与仅按逻辑顶部旋转不同，已依真实网页校正；首次移除实屏失败发现format=none仍需data空字符串，已补齐并验证无残影。媒体能力初次开启引入异步窗口初始化，已补代次保护和关闭时立即取消旧加载，旧恢复不得覆盖期间新媒体。旧mpv不支持OSD时按会话仅报一次错误，媒体/系统TTS继续，时钟不自动重启进程。本轮voiceDisplayNodePackage保持true、其余产物状态不变，没有构建/发布独立包或修改目标Windows配置；Windows实际画面和字体仍待现场验收。
