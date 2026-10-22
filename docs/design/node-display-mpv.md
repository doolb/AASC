# Node 子显示端常驻 mpv 播放

## 完整配置示例（2026-10-22）

用户要求恢复被删除的config.example.json，补全配置并写中文注释。示例以main.js和mpv-platform.js实际读取项为准，覆盖连接、VAD、录音回声处理模式、TTS期间录音策略、Windows文字输入声纹策略、mpv开关及两平台启动参数。displayId由hostname生成，采样率、重连间隔等内部固定值不列为可配置项；主题、能力开关和远端VAD继续由现有WebSocket同步。

现有加载器和配置回写均使用标准JSON，故采用_comments对象保存逐项中文说明，文件可直接复制为config.json，无需新依赖或修改解析器。注明默认值、单位、范围、可选值、远端覆盖关系、平台限制及路径填写方式；媒体默认关闭，Linux显示与认证默认继承环境，示例不包含实际账号凭据或本机路径。补文档与原配置/独立包兼容验证，独立包标记待构建。

## 需求与范围

用户已确认：现有控制端向 Node 子显示端发送视频、音频、图片，子显示端调用常驻 mpv；命令配置区分 Linux/Windows，Linux 可指定 DISPLAY/XAUTHORITY。支持四方向旋转和现有六种画面填充，媒体切换不反复启停进程。

本期实现单媒体及播放/暂停、进度、音量和清空。音视频循环播放，图片持续展示。批量播放列表、HTML和网页专用功能未接入mpv；单文档文本已通过独立ASS正文层接入。配置缺省关闭，旧配置继续提供语音功能。

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


## ASS文本媒体（2026-10-22，已实现）

用户询问能否使用ASS实现Node子显示端文本媒体。已核实现有网页文本媒体不止文字绘制，还包括txt/md解码、分页/重排、textStyle、textPlayback、逐句TTS与textProgress恢复，以及独立的远程语音目标协议。既有ASS信息字幕有2048字符/三行限制，因此正文使用独立分页层，保留完整文档。

已将ASS作为独立的文档正文显示层，Node负责有界加载、分句、分页、控制和恢复；复用同一个mpv及IPC，以独立OSD标识和较低层级绘制背景、正文、页码，现有时钟/连接/TTS/ASR位置保持。默认复用文本模式浅黄背景#FFF4B8、深灰正文#333333、字体/行距/页边距选项；旋转与窗口/样式变化按字符锚点重排，不将全文按字幕上限截断。

首版范围为单篇txt原文与md可读正文（保留段落/标题/列表文字，不承诺网页图片/表格/完整富文本布局），支持URL/base64、播放/暂停、上/下页、停止保留当前页、清空、逐句朗读与页码进度/重连恢复。用户已确认Markdown按可读正文、单文档及暂停后重播当前句的范围；批量/混合播放列表不在本轮默认范围。

复用control.textStyle/textPlayback、textSentenceTts及其错误/ready/finished消息，服务端负责单句合成与权威语音路由，不另加配置HTTP接口。声音仍使用系统AudioPlayer；已新增按文本播放上下文取消队列的能力，翻页/停文档不能误停普通TTS。系统播放器没有现成的跨平台句内暂停/续播接口，暂停时取消当前句，恢复从该句重播；按playbackId/页/句/目标校验迟到回包和完成通知，支持服务端选择本机或远端语音目标，TTS失败逐句跳过，无语音目标按既有文本降级策略处理。

已新增mpv-text-player.js与mpv-text-renderer.js，修改main.js/media-controller.js/mpv-player.js/audio-player.js，复用现有共享sentence-splitter与文本协议；按实际支持情况声明displayText并尊重权威能力开关。切换非文本媒体取消文档加载/翻页/TTS代次并移除正文层，清空正文保留信息层，不重启mpv。补文档专项、控制/恢复/TTS隔离、实际中文分页和四方向渲染测试，并按实际改动更新独立包状态与文档。

需求技能步骤0：输入指向L6文本媒体适配模块，兼有L5分页/朗读/取消生命周期；当前直接开发风险中。断点是Markdown呈现与范围、系统音频暂停差异以及远程语音路由；先告知具体方案并确认范围，再完成正式判级与实施，不将可行性分析当成功能完成。用户已确认具体范围后实施，L4伪代码见对应spec。

ASS文本实施补充：新增textSentenceTtsCancel仅取消可信源显示端匹配playbackId的上下文，解决显示端重排/清空/通用暂停时远端音频及时回收；不新增配置HTTP。独立包同步纳入共享分句器以避免解压后缺模块。enterprise结论可开发：主L6文本适配与协议，次L5分页/取消/恢复；证据为用户要求“ASS实现文本媒体”、确认单文档范围与逐句TTS方案，主证据6/8×0.90=0.675；评分24/25、20/20、17/20、18/20、15/15，共94/100，风险中，建议拆到对应L4后实施。

实现结果：URL/base64文本限制8MiB，Unicode线性分页、每页2048字符、最多100000行/20000页，超限明确报错；使用窗口坐标绘制独立OSD 41（低于信息层40）。共享分句器沿用现有规则；本机朗读按owner取消，远端目标校验后回执；请求/播放超时有界。断线作废下载、请求与计时器，保留已显示正文等待权威恢复。

验证：Node mpv 38项、服务端文本/路由53项、语音/重连22项、独立包22项、真实画面4项、真实mpv IPC 1项和网页布局对照1项通过，共141项。Windows字体/DPI和现场声音仍待验收。servicePackage/voiceDisplayNodePackage保持true；未构建或发布产物。

## ASS颜色、阴影与主题对齐（2026-10-22，已实现）

用户要求颜色样式、阴影、描边和主题与网页版一致。核对display.css/theme.css/ui-theme.js后，修改前ASS信息层只使用固定白字、1px黑边/阴影和固定黑底；现已接入主题，文档正文继续遵循textStyle配色。网页有15套主题，服务端已有controlThemeChanged及displayTtsBackgroundOpacityConfig初始化/广播，可直接复用，不新增配置HTTP或本机第二套主题选项。

方案：接收权威主题及透明度，离线默认dark/0.2，重连由服务端补发；时间保持90%白字、主题强调色正下方2px/65%投影及2px偏移8px黑色软阴影；TTS使用90%白字、0.5px主题色描边、同类分层阴影和上下淡出黑背景；ASR使用主题正文/背景/阴影，连接提示按主题success/danger/accent配色并绘制圆角背景。位置与旋转沿用已经对照网页的布局。单文档正文继续遵循网页版textStyle的配色和排版规则，页码复用主题次级文字色。

已新增mpv-appearance.js集中保存经校验的主题样式及ASS颜色/透明度映射，修改main.js、mpv-player.js、mpv-overlay.js及mpv-text-renderer.js，复用media-controller.updateOverlay接入消息和重绘。主题调色板以网页CSS为依据，自动对照15套主题的计算样式，避免无校验地复制后漂移。主题切换只重绘，不取消朗读或重排文档。ASS阴影/描边/圆角与渐变分层模拟CSS；网页backdrop-filter背景模糊及字体栅格差异不能承诺逐像素一致，用户已确认该边界。

需求技能步骤0：目标明确为Node的ASS可见文字外观对齐网页；拟覆盖时间/连接/TTS/ASR与文档正文现有样式，复用全局主题。主L6样式映射与消息契约，次L5配置恢复/重绘，直接开发风险中；用户确认具体方案后实施，已完成定向与真实画面验证。

本轮用户已确认方案与背景模糊近似边界。enterprise评审：主L6（样式映射/权威消息契约），次L5（恢复/合并重绘）；证据为“颜色样式”“阴影、描边”“主题”及已确认方案，主证据6/8×0.90=0.675；评分24/25、20/20、18/20、18/20、15/15，合计95/100，可开发、风险中。下放至L4颜色/透明度规范化、分层绘制和状态消息流程，不另行调用其他技能。

完成说明：调色板只保存实际使用的七类颜色并规范化透明度，初始dark/20%；非法消息保留当前快照。时钟/TTS阴影分别绘制（CSS 8px模糊近似ASS blur4，ASR CSS 4px近似blur2），TTS细描边由ASS先画描边再画字面；背景用圆角贝塞尔路径，渐变由上下各6段与中间峰值段共13层实现，文字透明度独立。换主题只重绘正文页码，不调用文档reflow或重发TTS。

验证71项通过：mpv42、浏览器布局/主题对照1（15套计算样式与8组窗口旋转）、真实画面5（含两主题×四旋转）、真实IPC1、独立包22。灰底180上的60%黑背景实测峰值72、边缘170；白字、主题彩色像素、黑色软阴影及零透明度背景移除通过。只将voiceDisplayNodePackage标为true，其他产物状态保持本轮前值，未构建或发布包；Windows字体/DPI仍待现场验收。

## mpv鼠标点击采集（2026-10-22，方案待确认）

用户询问Node能否获取mpv窗口内鼠标点击。现有常驻播放器已具备JSON IPC事件接收，但receiveEvent只处理媒体/属性消息，未接入鼠标。官方Lua键绑定支持鼠标按键及complex按下/松开事件，mouse-pos提供与OSD尺寸一致的坐标和hover状态，client-message可经现有IPC传给Node。

建议首版只做采集与Node事件分发：支持左/中/右键、左键双击及按下/松开，标准click在有效按下/松开后产生；事件包含窗口坐标、OSD宽高、旋转后的ASS逻辑坐标及按钮/阶段。视频裁剪/平移不改变ASS命中坐标；不默认把窗口坐标冒充原视频像素，不额外接入全局桌面鼠标监听、业务按钮或服务端新消息。

拟新增mpv-pointer.lua在自己的mpv会话内绑定鼠标并发送带命名空间的script-message，新增mpv-pointer.js规范化/校验/坐标换算，修改mpv-player.js加载桥接脚本与接收client-message，修改media-controller.js暴露Node本地pointer事件。点击采集会接管对应mpv鼠标键，具体业务动作待下一步指定；不擅自绑定播放暂停或翻页。Linux和Windows共用mpv机制，不新增系统鼠标钩子或生产npm依赖。

加载脚本需要支持Lua的mpv；握手失败或Lua不可用时明确报错并保留媒体播放。媒体能力关闭/退出注销绑定并停止分发，按会话代次丢弃旧事件；重建只安装一份桥接。鼠标移出窗口的失效坐标忽略，窗口尺寸和rotation以当前会话校验，防止旧尺寸事件误命中。双击与单击可能按原生鼠标语义相继产生，本轮仅采集，消费侧业务需要选择处理方式。

需求技能步骤0：采集能力可实现，后续点击业务尚未指定；建议先确认上述采集范围。主L6输入桥接/事件契约，次L5会话绑定/点击状态，直接开发风险中；等待具体方案确认后再更新实施伪代码并开发。依据为mpv官方manual的Lua key bindings、mouse-pos和client-message章节。本轮仅核对源码/官方接口，未修改生产代码、运行点击功能测试或变更发布状态。

## TTS URL is not a constructor（2026-10-22，已修复）

用户实际日志连续报告TTS加入队列失败。根因为main.js原有const URL=require('url')得到模块对象，connect还通过URL.parse解析WebSocket服务器地址；此前新增音频地址处理直接new URL将该对象当构造器调用。既有VM测试只抽取VoiceDisplay类并注入全局URL构造器，未执行实际导入，导致测试漏报。这是本轮前音频地址适配引入的回归。

已只读提取真实导入和playAudioFromURL，最小夹具重现queued为空及同一错误；仅在内存补const {URL:NodeURL}=require('node:url')并使用new NodeURL后，/uploads/tts/test.wav正确进入https://example.invalid:8081/uploads/tts/test.wav队列。定位阶段未连接真实音频源或播放声音，候选当时仅在内存验证；随后经用户确认落地。

用户确认后，在main.js显式引入NodeURL构造器别名，保留URL模块给既有connect.parse使用；测试执行源文件的真实URL导入声明，覆盖相对/绝对HTTP(S)、非法地址/协议、错误回调和队列options，并捕获HTTP/HTTPS连接生成的ws/wss地址。未修改本机配置或系统播放命令。

需求明确性已满足，局部URL适配属于L5播放前输入处理，次L4导入/调用声明；证据为真实用户错误、模块与构造器同名冲突、使用真实导入夹具复现及内存候选验证。直接开发风险低，实施前按对应伪代码保留错误回调和原连接行为；用户已确认方案后落地修复。

验证：新增真实导入回归在原生产代码上失败，修复后mpv专项43/43、语音/重连/Windows输入22/22，共65项通过；未向真实音频源联网或执行设备播报。voiceDisplayNodePackage原已为true，保持待构建，其他发布状态保留；未构建发布包。

enterprise评审：主L5音频入队前解析流程，次L4导入与调用声明；真实日志、实际导入重现、内存候选与新测试先失败后通过构成证据。置信度6/8×0.90=0.675；评分24/25、20/20、19/20、19/20、15/15，共97/100，可开发、风险低，已按L4伪代码实施。

## Linux TTS ALSA设备占用（2026-10-22，已实现）

用户日志显示TTS下载118846字节成功，aplay打开ALSA dmix从设备时报告Device or resource busy。修复前audio-player.js固定使用aplay -q -t wav，没有-D设备选择；mpv的audio-exclusive=no不等同于所有ALSA客户端自动进入同一共享混音链路。仅凭日志不能确认具体占用者，更不能保证由mpv独占导致。

当前工作环境arch0只读检查：pactl info为PulseAudio兼容服务运行于PipeWire 1.6.8；aplay -L同时包含pulse/pipewire；fuser显示播放PCM设备由pipewire进程占用。因此该环境应让TTS通过共享音频服务播放，而非默认dmix争抢已经由服务管理的硬件。尚未确认用户报错设备就是arch0，不把本机检查冒充目标设备验收。

已保留aplay并新增linux-audio-output.js负责输出选择：本机audioPlayer.linux.device默认auto，有界探测aplay PCM列表与可达Pulse/PipeWire服务，优先pulse、再pipewire，没有可用共享入口则沿用default；显式device直接使用，不偷偷切换其他设备。只通过独立参数传-D，不执行shell命令串、不修改系统ALSA配置、不关闭其他应用或音频服务。Windows PowerShell播放保持原有路径。

修改audio-player.js/main.js传递本机配置并在播放前选择设备，更新config.example.json及使用文档，补探测缓存/超时/无服务/显式设备、播放取消/owner隔离与原队列/AEC回归。探测应在PCM参考信号通知前完成，旧下载/取消代次不得在探测返回后重新播放；已经开始的音频不自动换后端重播，避免重复播报。配置只属于本机物理输出，不新增控制端或HTTP配置接口。

需求技能步骤0：错误阶段明确，目标设备具体服务状态仍需核对；修复方案是在现有TTS保留系统命令前提下接共享入口。主L6本机Linux输出适配与配置契约，次L5探测/缓存/取消生命周期，风险中；用户确认后先更新伪代码，再实施适配及回归。

用户已确认自动/显式共享输出方案。enterprise评审：主L6 Linux输出适配，次L5探测/缓存/取消；证据为下载成功后的aplay错误、固定default代码、工作机服务/PCM/占用查询及已确认方案；主证据6/8×0.90=0.675，评分24/25、20/20、18/20、18/20、15/15，95/100，可开发、风险中。下放到设备规范化、并行有界探测、代次保护与独立参数播放伪代码实施。

实现与验证：linux-audio-output.js并行探测三条命令，每条最多2秒，超时强制终止且限制输出；实例内缓存选择结果，显式PCM跳过探测。mpv专项50/50、配置4/4、独立包22/22、语音/重连/Windows输入22/22，共98项自动测试通过。工作机静音验证aplay通过pulse成功播放完成；mpv与TTS联测未完成有效的同时输出确认，不作为目标设备混音验收。未改系统音频配置或停止其他应用；voiceDisplayNodePackage保持true，未构建发布包，目标部署后实际混音另验。
