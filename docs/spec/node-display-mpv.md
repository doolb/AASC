# Node 子显示端常驻 mpv 伪代码

## 完整配置示例与中文注释（2026-10-22）

```text
已有声明 := main.loadConfig、VoiceDisplay.start/applyVadConfig、platformOptions、现有configUpdate保留本机配置
新增定义 := config.example.json的_comments说明映射；不增加运行参数或配置解析器
字段来源 := 实际读取的serverUrl、VAD三项、recordingMode、pauseRecordingDuringPlayback、textInput.requireVoiceprint、mediaPlayer与平台选项
恢复示例 → 每项使用当前默认值 → _comments注明单位/范围/可选值/本机与远端权威关系 → 标准JSON保存
displayId := hostname自动生成，配置文件同名字段被忽略；configPath/采样率/重连参数等运行时固定值不伪装为可配置项
复制示例为config.json → 按环境修改serverUrl与mpv路径 → 原JSON.parse/loadConfig读取；注释作为无业务语义的元数据保留
示例默认 := mute、VAD 0.01/500ms/300ms、播放时暂停录音、文字输入声纹关闭、媒体关闭、Linux继承DISPLAY/XAUTHORITY
远端 := 原WebSocket权威VAD与播放录音策略继续覆盖启动值；媒体显示能力/主题/透明度等继续走原远端配置
验证 := JSON解析与实际loadConfig读取、原配置失败进程测试、跨平台选项解析、独立包包含示例且排除本机config.json
产物 := 示例进入Node独立包，voiceDisplayNodePackage置true；其余已有状态保留，不执行构建发布
```

## 鼠标事件桥接（待确认，未实现）

```text
已有声明 := 常驻mpv会话/JSON IPC、MpvPlayer.receiveEvent、ASS窗口尺寸与旋转、NodeMediaController能力开关
新增定义 := Lua点击桥接、握手/会话代次、鼠标键与阶段、有效按下记录、窗口及逻辑坐标、本地pointer事件
首版范围 := 左/中/右键、左键双击、按下/松开/有效click；只采集，不自动绑定业务动作
会话就绪 → 显式加载自己的Lua脚本 → 有界握手 → 按能力启用鼠标绑定
Lua鼠标键回调 → mouse-pos与OSD尺寸 → 命名空间script-message → 现有IPC client-message
回包 → 校验来源会话/消息名/长度/按钮/阶段/有限坐标/hover/宽高 → 生成窗口坐标
窗口坐标与当前旋转 → 逆ASS physicalPoint映射 → 逻辑坐标，原始视频像素需另行结合裁剪/缩放换算
有效按下后松开 → click；双击 → 独立double事件，保留原生单击/双击顺序供消费侧选择
标准事件 → NodeMediaController本地pointer分发；不新增服务端消息或配置HTTP
尺寸/会话变化、窗口外松开、能力关闭/退出 → 取消未完成点击，丢弃旧上下文事件
重建 → 重新握手/绑定一份；Lua不可用/握手超时 → 明确报错，不停止原媒体播放
自测 := 键/阶段/坐标与非法事件、四方向逆映射、尺寸/旧会话隔离、重复初始化、关闭与可选Lua失败
实屏 := 隔离Xvnc内真实鼠标注入与IPC回包验证；不操作当前用户桌面，Windows现场另验
状态 := 等待用户确认采集范围；没有鼠标业务代码或功能测试结果
```

## ASS主题与文字外观（已实现）

```text
已有声明 := 网页theme.css/display.css、15套UiTheme主题、服务端主题/透明度初始化与广播、Node ASS信息层与正文层
新增定义 := 权威主题快照、白名单调色板、ASS颜色/alpha映射、描边/阴影分层、圆角与渐变绘制
本地默认 := dark主题、TTS背景峰值0.2；非法主题/颜色/透明度不进入ASS指令
controlThemeChanged/opacityConfig → 规范化权威值 → 更新信息层与正文页码样式 → 合并重绘
重连 → 由服务端补发主题与透明度；复用已有WebSocket，不新增HTTP配置或重复本机主题参数
时钟 → 90%白字 → 主题强调色2px/65%下影与偏移2px/模糊8px黑影分层
TTS → 90%白字与0.5px主题描边 → 主题下影/黑影 → 按权威透明度生成上下淡出背景
ASR/连接 → 主题正文/背景/阴影及success-danger-accent状态色 → 圆角背景与ASS文本
文档正文 → 原textStyle主题规则；页码 → 网页次级文字色；切换主题只重绘，不重发朗读或改变页/句
尺寸/旋转 → 保留已验证位置，绘制效果随文字方向旋转
验收 := 15套主题真实网页计算值对照、默认/非法值/初连重连/连续切换、颜色透明度/描边阴影真实画面、四方向/原文本朗读回归
边界 := ASS分层近似CSS；backdrop-filter背景模糊不承诺原样复现，字体与栅格效果需平台现场验收
绘制 := 每段文字先绘制独立模糊阴影，再绘制主题下影，最后绘制字面/细描边；所有默认ASS阴影与描边显式复位
背景 := 圆角贝塞尔路径；TTS上下各6条渐变裁片与中间峰值段，共13层，使用旋转后的窗口裁片边界
调色板 := 本机只包含网页15套实际使用颜色，运行时不读CSS；浏览器回归验证计算样式防止漂移
消息/外观 := main接收权威主题与透明度，经controller更新overlay快照；同一队列同时重绘正文页码，不调用文本reflow
阴影模糊 := CSS8px近似ASS blur4，CSS4px近似blur2；字面与背景透明度独立
状态 := 用户已确认后实现；mpv42/布局主题1/实屏5/真实IPC1/独立包22，共71项通过；Windows现场另验
```

## ASS文本媒体（已实现）

```text
已有声明 := NodeMediaController媒体/控制/恢复、MpvPlayer常驻IPC、ASS信息层、AudioPlayer队列、共享sentence-splitter
已有协议 := mediaType:text + format:plain/markdown、control{textStyle/textPlayback}、textSentenceTts及ready/error/finished、textProgress
新增定义 := OSD排空标记（同步结束，避免Promise finally窗口漏刷新）、文档源/加载代次、全文/可读文本、页数组与字符锚点、当前页/句/播放状态、正文OSD标识、文本音频所有者与取消代次
确认范围 → 单文档txt与md可读正文；暂停恢复重播当前句；完整网页富文本/批量列表另定
新增配套 := textSentenceTtsCancel按可信发送端及播放ID取消服务端旧上下文；独立包纳入共享sentence-splitter
加载上限 := 8MiB，UTF-8替换解码；分页线性扫描Unicode字符，单页至多2048字符，整篇不按字幕长度截断；超过有界行数/页数明确失败
音频取消 := 队列条目带owner；只移除匹配待播条目，匹配当前条目则中止其下载/子进程，原队列继续其他owner，不重置整队列录音回调
权威媒体/文本能力允许 → URL/base64有界加载并可取消 → UTF-8解码 → txt保留原文、md提取安全可读正文
全文 → 按窗口逻辑尺寸/字体/行距/页边距量测换行 → 分页及原文字符锚点；不复用信息字幕2048字符/三行截断
当前页 → 背景/正文/页码ASS → 独立低层级osd-overlay；时钟/TTS/ASR仍由既有信息层绘制
旋转/窗口/样式变化 → 取消旧句 → 按字符锚点重新分页 → 重绘当前页，保持播放或暂停状态
播放 → 当前页共享规则分句 → 携带playbackId/页/句/route请求单句TTS → 校验回包定位
本机目标 → 系统AudioPlayer按文档所有者入队 → 正确完成该句后推进下一句
本机voicePlayback被关闭 → 取消本机当前句 → 新代次重发当前句，由服务端重新选目标或阅读降级
通用TTS停止 → 先停止系统队列，再暂停文本；正文绘制失败只记录错误，仍完成原停止处理
远程目标 → 等待现有ready/finished权威通知后推进，不重复本机播音；Node作为远程目标时也回报完成/失败
合成/播放失败回包 → 记录错误并跳过该句；请求60秒/播放120秒超时 → 取消上下文并上报error；无语音目标 → 沿用既有文本阅读降级策略，避免停死
当前页句子结束 → 下一页 → 文档末页结束后上报finished，不擅自触发未接入的播放列表切换
暂停 → 取消在途请求/本句音频，只影响该文本上下文 → 保存当前页/句
恢复 → 新播放代次从暂停的当前句重新请求并播报；系统播放器不承诺句内毫秒续播
上/下页 → 作废旧请求/音频/完成回调 → 最终目标页重绘与朗读；停止保留页，清空删除正文
textProgress → 既有AASC持久化及控制端页码更新；恢复读取currentTextProgress/textStyle并保持暂停
切换图片/视频/音频 → 作废文档加载及朗读代次 → 移除正文ASS层 → 原媒体链路；保留普通TTS和信息层
断线 → 作废下载与播放代次并暂停，保留已显示正文，等待权威恢复
退出/能力关闭 → 释放文档状态、请求与计时器，不留下迟到自动翻页
正文清空/能力关闭 → 并行发起正文移除与原生清空，立即作废原生加载，不等待旧ASS回执后误停新媒体
自测 := UTF-8/中文长文不丢字、Markdown安全转换、ASS转义、页码/控制/样式/四旋转、句级恢复及晚回包隔离
真实画面 := 分页完整可见、主题/页边距/页码与信息层共存、旋转重排及非文本切换，PID保持；Windows另验
```

## ASS信息叠加（已实现）

```text
已有声明 := VoiceDisplay连接事件/handleTTS/ASR回调、AudioPlayer队列、MpvPlayer常驻IPC与会话回收
已有数据 := 本地Date、WebSocket连接状态、tts.text、formatAsrDisplayText、displayStatusBarConfig
新增定义 := 信息快照 { 时钟, 连接状态, TTS当前条目, ASR文本, 状态栏可见, 旋转, 窗口尺寸 }
新增定义 := ASS布局与转义、唯一OSD标识、逐条播放通知、文字失效代次、刷新任务及隐藏计时器
用户明确位置须与网页版一致 → 按已有文件方案接入信息层；本地默认开启，未获权威媒体能力前只记忆状态
媒体能力开启且mpv可用 → 同一常驻进程按需启动黑底空闲窗口 → 初始快照
时钟 → 本地HH:mm:ss，每秒更新；连接事件 → 立即更新连接中/已连接/断开或错误
状态栏配置 → 按目标displayId过滤 → 复用showStatusBar权威值；只控制连接提示
TTS消息 → 文字随原队列条目保存 → 实际条目播放开始通知 → 显示该条目文本
下一条开始 → 替换旧文字；停止/失败 → 清除；最后条目完成 → 暂留30秒 → 按代次隐藏
原onPlayStart/onPlayEnd录音模式回调、onComplete与系统播放命令 → 保持既有职责
ASR成功/ignored且有格式化文本 → 同步原TUI与信息层 → 30秒后隐藏；新结果使旧隐藏回调失效
文本 → 校验长度与ASS转义 → 中文换行 → 按网页最终锚点/边距/字号/旋转生成ASS事件
位置基准 := 时钟右上20、连接左上20；TTS逻辑顶部居中，0度偏移160、180度逻辑起点160减盒高、90/270度沿用最终自适应边距；ASR底部居中，保留网页按钮/状态及间距占位
网页布局回归 := 浏览器执行真实布局函数与CSS → 与ASS锚点/包围盒比较，四旋转和横竖窗口；不只检查生产代码自行算出的坐标
信息快照 → 合并高频刷新 → 同IPC命名参数osd-overlay{format:ass-events,id,data,res_x,res_y}
叠加坐标 → 窗口逻辑布局；不参与video-zoom/pan或媒体裁剪，不占用媒体字幕轨
暂停/纯音频/清空媒体/断网 → 继续当前信息与时钟；媒体切换或窗口变化 → 重绘
会话失效 → 停止写旧IPC，保存最新状态；不由时钟无限拉起崩溃进程 → 下次有效启动重放
能力关闭 → 同步作废媒体加载与待恢复 → OSD命名参数{format:none,data:空字符串}移除 → 取消刷新及隐藏计时
开启媒体能力 → 记录能力/媒体代次 → 异步启动空闲窗口 → 代次已改变则跳过旧恢复，控制输入仍更新待恢复参数
退出 → 关闭信息模块 → 拒绝/等待在途IPC → 释放自有资源；本地mpv关闭/不可用时不创建信息计时器
自测 := 队列两条错序到达/停止/失败、ASR超时与旧回调、ASS转义/中文/长文本、时钟/连接状态
实屏 := 空闲黑底/图像/视频/纯音频/暂停/清空、四旋转与裁剪、常驻PID、重建及退出
渲染失败 → 本会话标记失败、只报一次，不阻断媒体或TTS；后续有效新会话重放
发布 := voiceDisplayNodePackage保持true，其他项不变；按规则同步Git，不构建或发布本轮独立包
验证 := 专项27/27、网页布局1/1、实屏3/3、真实IPC 1/1、独立包22/22、语音/重连/Windows输入22/22，共76项，零跳过
```

## 裁剪移动（已实现）

```text
已有声明 := crop百分比消息、calculateGeometry、MpvPlayer.control/applyGeometry/writeGeometry、restoreState
确认输入 := 控制端裁剪框拖动或缩放、X/Y/宽高输入
已有服务链 := control{type,displayId,action:crop,value} → 服务端保存crop并转发 → Node媒体控制器
新增定义 := 视觉版本、单个同媒体代次的合并任务 { 媒体代次, 共享完成回执 }
crop输入 → 规范化矩形 → 更新最新视觉版本/fit → 合并连续请求
媒体/窗口尺寸未就绪 → 记忆矩形 → 尺寸就绪后应用最新状态
裁剪几何 → 按现有预览坐标求目标视觉矩形 → 等比缩放换算log2至video-zoom
目标矩形与窗口中心差 → 换算video-pan-x/y → IPC应用；四方向均以实际像素检验
连续移动 → 更新最终zoom/pan，避免每次归零再偏移；至多一个应用任务
新输入到达 → 旧版本停止继续写属性 → 单任务继续应用最新值 → 共享完成回执，不为每次拖动增加串行任务
尺寸变化 → 原50毫秒节流 → 增加视觉版本 → 复用合并任务，不与控制输入并发写几何
应用裁剪 → 固定居中对齐、保留比例、panscan=0、可选scale复位1 → 直接写最终zoom/pan，不先归零
切换媒体/填充/清空/退出 → 作废旧更新；原生填充复位zoom/pan，保持panscan逻辑
恢复连接或重建进程 → 沿用既有fit/crop状态重放 → 保持TTS独立
自测 := 旧mpv无scale属性、横纵移动/四旋转、连续拖动最终值、恢复及模式切换、PID不变
实屏验收 := 隔离Xvnc红绿渐变图的四方向横纵四角共16组、真实视频2组 → 中心像素匹配原图坐标逆变换；PID保持、缩放减半及contain复位通过；Windows另行验收
验证结果 := 专项21/21、真实mpv IPC 1/1、真实画面2/2、独立包22/22，共46项，零跳过
```

已实现于mpv-player/mpv-platform/mpv-geometry/media-controller及VoiceDisplay接入。

## 配置错误启动流程（已实现）

```text
已有声明 := loadConfig、main、start.bat
新增定义 := 配置错误 { 绝对路径, 读取或解析或字段原因, 非零退出码 }
配置路径 → 读取文件 → JSON解析 → 校验根对象及显式HTTP/HTTPS服务器地址
配置校验前移到TUI/WS/录音模块加载之前；启动参数中的--no-tui不当作配置路径
任一步失败 → 同步写stderr的ERROR及绝对路径/阶段/原因 → 非零退出；不创建TUI或启动业务、不回退localhost
成功 → 合并可选字段默认值 → 原连接和播放流程
Windows启动器 → 切换自身目录 → 调用已有npm start → 保存退出码
退出码非零 → 暂停显示错误 → 返回原失败码
自测 → 缺文件/坏JSON/非法根/非法地址、有效配置、stderr可见、零连接及失败码
```

## 原生panscan填充流程（已实现）

```text
已有声明 := MpvPlayer.applyGeometry / startDynamic / writeGeometry / geometry
新增定义 := 原生填充映射 { contain: 0, cover: 1 }、动态panscan当前值与阶段
填充控制 → 取消旧动态调度 → keepaspect开启、video-unscaled关闭
非crop模式 → 复位zoom/scale/pan → 设置旋转 → 下发原生panscan
旧mpv缺少可选scale属性 → 跳过不存在的复位属性，不阻断原生panscan；必要属性失败仍返回错误
contain → panscan=0；cover → panscan=1；均不依赖decoder或窗口尺寸才可执行
height/width → 已处理文件方向的媒体比例与用户旋转与窗口比例 → 选择适应0或铺满1
尺寸暂不可用 → height/width先用适应，属性就绪后重放；contain/cover/dynamic不等待尺寸
dynamic → 从0开始 → 按现有停留/过渡参数在0与1间插值 → 单调度器、有界IPC、旧代次退出
crop → panscan=0 → 保留既有百分比几何及缩放/平移
裁剪切回原生模式 → 完整复位旧缩放和平移，避免叠加放大
状态恢复/媒体切换/崩溃重建 → 重放当前原生填充属性，保持常驻进程
自测 → 核对panscan实际回执与读值、中间渐变、旋转/比例/切换、PID及TTS隔离
设备验收 → Windows实际画面可见结果，不以null输出或IPC成功替代
```

## 当前媒体播放流程

配置失败与原生panscan行为见上方已实现流程，下方描述媒体全链路。

```text
已有声明 := VoiceDisplay.handleMessage / handleControl / declareCapabilities / stop、原AudioPlayer
已有输入 := url/base64/media、control、restoreState.state、capabilitiesUpdated、平台、本机配置
新增定义 := mediaPlayer { enabled, linux { command, args, display, xauthority }, windows { command, args } }
新增状态 := 可用性、常驻进程、唯一初始化、IPC连接、命令回执、加载队列、请求代次、恢复代次
新增画面 := 旋转0、填充contain、百分比裁剪、动态参数、单个动态调度器

mediaPlayer配置缺省或关闭 → 不探测/启动mpv，继续原语音功能
本机配置修复（2026-10-22） := 补齐最外层对象闭合并开启mediaPlayer；解析成功 → 使用已配置serverUrl，不触发localhost默认回退
开启配置 → 当前平台选择命令和参数数组 → 有界mpv版本探测 → 声明实际可用性
媒体能力获权威开启且mpv可用 → 选择Linux socket或Windows独立命名管道 → 启动空闲信息窗口；首次有效媒体复用该进程
Linux DISPLAY/认证 → xdpyinfo验证；显式认证失败直接报错，继承失败再搜索参考脚本候选
可执行文件与参数数组 → shell关闭 → 追加idle/keep-open/fullscreen/专属IPC/audio-exclusive=no → 启动自有进程
初始化去重 → 有界连接IPC → 订阅播放属性、媒体尺寸、窗口尺寸
JSON命令 → 独立request_id → 对应回执完成/失败；超时移除；断开/退出拒绝待处理命令

url媒体 → 只接受HTTP/HTTPS或相对服务地址 → 加载失败尝试现有fallbackUrl
base64媒体 → 校验编码与64MiB上限 → 写本实例私有临时文件，不拼入进程参数
新媒体 → 增加代次并取消旧加载等待 → 串行loadfile替换 → 同时等待命令回执与file-loaded
过期媒体 → 不再应用状态或启动动画 → 回收临时资源
有效媒体 → 应用当前音量/暂停 → 有效断点夹取媒体时长 → 应用画面 → 上报播放状态
音视频 → 循环；图片 → 持续展示；HTML/文本 → 失败回执

rotate → 校验四方向 → 记忆并实时设置video-rotate
fit → 校验contain/cover/height/width/dynamic/crop → 取消旧动态调度 → 记忆模式
crop → 规范化百分比 → 进入crop模式；dynamicFitConfig → 规范化过渡/停留时间
decoder尺寸和文件方向 → 浏览器同义固有尺寸 → 叠加用户旋转 → 与窗口尺寸计算矩形
contain/cover → 等比完整/等比覆盖居中裁切
height/width → 沿用网页旋转轴语义；crop → 按网页百分比规则换算视觉矩形
非crop → 复位旧缩放平移并下发原生panscan；crop矩形 → mpv缩放和平移；回执校验，旧代次不继续写入
动态模式 → panscan在0与1间插值与停留 → 至多20Hz且逐次等待IPC、一个调度器
无视觉媒体 → 保存参数；窗口尺寸变化/切换媒体/恢复/重建 → 重算并重放

播放/暂停/音量/百分比seek → 映射已有control值到IPC
清空 → 增加代次/取消在途加载和动态调度 → IPC stop → 回收临时文件 → 保留进程
Windows文件被短暂占用 → 有限重试 → 失败记录并保留退出目录回收兜底
媒体能力关闭 → 清空并拒绝新媒体，保持原语音能力流程
恢复到达但能力未知 → 暂存；收到权威能力 → 同步记忆画面参数 → 恢复媒体/暂停/断点
新媒体/清空/断线/能力关闭 → 增加恢复代次 → 旧恢复不覆盖新请求
播放状态/媒体类型变化 → playStateReport；音视频普通进度 → 约每秒一次audioProgress/videoProgress，状态变化即时反馈
窗口尺寸变化 → canvasSize；命令完成 → commandAck { details, timestamp, 本次correlationId }

TTS消息 → 原AudioPlayer队列 → Windows PowerShell或Linux aplay内存输入
TTS开始/停止只操作原播放器；媒体清空只操作mpv；同时发声交由系统共享音频输出
mpv崩溃/IPC失效 → 停止调度、拒绝待处理命令、回收自有进程/目录 → 下次播放按需重建
Node退出 → 取消初始化/加载/恢复/动态 → 等待自有mpv有界退出与清理 → 再结束Node
服务端生成子显示端配置 → 读取并保留本机设置含mediaPlayer → 补缺失默认值并更新地址 → 写回
本轮改动 → voiceDisplayNodePackage/servicePackage设true → 按规则同步Git；不构建APK/独立包
```
