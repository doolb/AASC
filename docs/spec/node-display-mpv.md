# Node 子显示端常驻 mpv 伪代码

已实现于mpv-player/mpv-platform/mpv-geometry/media-controller及VoiceDisplay接入。

```text
已有声明 := VoiceDisplay.handleMessage / handleControl / declareCapabilities / stop、原AudioPlayer
已有输入 := url/base64/media、control、restoreState.state、capabilitiesUpdated、平台、本机配置
新增定义 := mediaPlayer { enabled, linux { command, args, display, xauthority }, windows { command, args } }
新增状态 := 可用性、常驻进程、唯一初始化、IPC连接、命令回执、加载队列、请求代次、恢复代次
新增画面 := 旋转0、填充contain、百分比裁剪、动态参数、单个动态调度器

配置缺省或关闭 → 不探测/启动mpv，继续原语音功能
开启配置 → 当前平台选择命令和参数数组 → 有界mpv版本探测 → 声明实际可用性
首次有效媒体 → 等待权威媒体能力 → 选择Linux socket或Windows独立命名管道
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
视觉矩形 → mpv缩放和平移 → 每个命令回执校验，旧代次不继续写入
动态模式 → contain/cover间插值与停留 → 至多20Hz且逐次等待IPC、一个调度器
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
