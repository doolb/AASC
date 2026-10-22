# Node 子显示端常驻 mpv 伪代码

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
