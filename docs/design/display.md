# 显示端设计文档

## 功能概述

显示端是媒体展示的核心组件，负责接收控制端指令并展示媒体内容。

## 画面适配模式

| 模式 | 说明 |
|------|------|
| contain | 适应屏幕，保持比例（按旋转角度/屏幕比例/媒体比例自动选择高度或宽度铺满，完整显示） |
| cover | 铺满模式，等比放大覆盖整个屏幕，超出部分居中裁切 |
| height | 高度铺满屏幕 |
| width | 宽度铺满屏幕 |
| crop | 裁剪模式，铺满屏幕 |
| dynamic | 动态模式，在适应和铺满之间按配置循环过渡 |

动态模式默认过渡 3 秒、停留 2 秒，控制端可针对当前显示端调整并持久化这两个时间。

## 旋转处理

- 支持 0°、90°、180°、270°
- 旋转 90° 或 270° 时，height/width 模式效果互换

### UI四角布局

旋转后UI元素保持在以0度为基准的画面四角，根据新重力方向整体旋转文字；90°/270°同时交换逻辑画布宽高并重新校正固定文本包围盒。

| 位置 | UI元素 | 说明 |
|------|--------|------|
| 左上 | connectionStatus | 连接状态 |
| 右上 | timeDisplay | 时间显示 |
| 左下 | fileNameDisplay | 文件名 |
| 右下 | monitor-wrapper + voiceStatus | 音频可视化 + 语音状态 |

`voiceTextDisplay`（TTS 播报文本和语音识别结果共用）随语音状态区域定位；旋转 90°/180°/270° 时分别整体旋转对应角度，保证汉字字形与显示器画面方向一致。

### 旋转文字

| 旋转角度 | 重力方向 | 文字方向 |
|----------|----------|----------|
| 0° | 向下 | 水平，从左到右 |
| 90° | 向右 | 整体顺时针旋转90°，汉字字形随画面旋转 |
| 180° | 向上 | 水平，翻转180度 |
| 270° | 向左 | 整体逆时针旋转90°，汉字字形随画面旋转 |


## 裁剪功能

- 裁剪区域使用百分比 (0-100)
- 裁剪框比例与显示端屏幕比例一致
- 只支持等比缩放

## 显示端选择模式

### 单选模式
- 默认模式，选择单个显示端进行媒体下发
- `window.currentDisplayId` 存储当前选中的显示端 ID

### 全选模式
- 选择所有已连接的显示端
- 媒体下发时，遍历所有显示端并发送

### 自适应模式
- 根据显示端画面比例和媒体比例自动匹配
- 横向媒体（宽 > 高）下发到横向显示端
- 纵向媒体（高 > 宽）下发到纵向显示端
- 显示端方向判断需考虑旋转角度：
  - 0°/180°：原始方向
  - 90°/270°：方向互换

## 相关文件

| 文件 | 说明 |
|------|------|
| public/display.html | 显示端页面 |
| public/css/display.css | 显示端样式 |
| public/js/display-list.js | 显示端列表管理 |

## WebSocket 重连清理

显示端复用本地持久化的 `displayId` 重连时，服务端按 WebSocket 对象身份维护当前连接。新连接接管旧连接并关闭旧 WebSocket；旧连接延迟触发 `close` 时只释放自身监听，不删除当前连接。显示端列表对同一 `displayId` 保持单条记录，避免 Agent 测试浏览器或页面刷新产生长期残留连接。

---

# 已完成功能

## 显示端信息
 - ✅已完成 显示端 navigator.userAgent
   - 功能：判断显示端的浏览器类型，控制端可查看内容
   - 参考：public/showinfo.html
 - ✅已完成 控制端显示列表详情按钮
   - 改动文件：public/display.html
   - 功能：点击可查看显示端的功能支持（Feature Support）

## CSS 拆分
 - ✅已完成 display.html CSS 拆分到 `public/css/display.css`
   - 包含媒体容器、时间显示、文件名显示、连接状态样式
   - 包含提醒弹窗样式 `.reminder-popup`
   - 包含响应式布局 `@media (max-width: 768px)`

## 显示端语音识别
 - ✅已完成 [2026-03-29][2026-03-29] 显示端启动时默认注册语音识别
   - 改动文件：public/display.html, server.js, public/js/websocket.js, public/js/chat.js
   - 功能：显示端启动时自动启动语音识别，识别结果转发到控制端
   - 语音识别结果通过 WebSocket 发送到服务端，服务端转发给控制端
   - 控制端 Chat 模块接收语音输入，支持"聊天xxx"触发对话
 - ✅已完成 [2026-03-29][2026-03-29] 显示端语音识别状态显示
   - 改动文件：public/display.html, server.js, public/js/display-list.js, public/css/upload.css
   - 功能：控制端显示端列表显示语音识别状态图标
   - 状态：🎤 识别中（闪烁）、🎤 就绪（半透明）、🎤 不支持（灰色）

## 显示端选择模式
 - ✅已完成 [2026-03-31][2026-03-31] 显示端全选和自适应功能
   - 改动文件：public/js/display-list.js, public/js/websocket.js, server.js, public/css/upload.css
   - 功能：新增三种选择模式（单选、全选、自适应）
   - 全选模式：媒体下发到所有已连接的显示端
   - 自适应模式：根据媒体比例自动匹配显示端方向
   - 显示端列表新增方向指示器（↔ 横向 / ↕ 纵向）
   - 实现文档：docs/spec/display-selection.md
   - 任务文档：docs/task/2026-03-31_显示端全选和自适应功能.md

## 显示端UI旋转
 - ✅已完成 [2026-04-12][2026-04-12] UI四角布局 + 旋转重力方向调整
   - 改动文件：public/display.html, public/css/display.css, server.js
   - 功能：UI元素按四角布局（连接状态左上、时间右上、文件名左下、音频可视化/语音右下），旋转后保持在0度基准的物理位置，文字方向根据重力方向调整
   - 90度/270度使用 transform: rotate(90deg)/rotate(270deg) 使汉字字形整体随画面旋转
   - 180度使用 transform: rotate(180deg) 翻转文字
   - connectionStatus 和 monitor-wrapper 纳入旋转管理
   - 实现文档：docs/spec/display-ui-rotation.md
 - ✅已完成 [2026-08-26][2026-08-26] 修复播报文本旋转适配并放大字号
   - `voiceTextDisplay` 在 90°/270° 时补齐竖排方向和旋转适配，避免显示器旋转后播报文字仍保持横排。
   - 播报文本字号按当前字号增加 50%，桌面端为 36px，移动端为 27px。
   - 淡入动画仅改变透明度，不覆盖旋转变换。
   - 验证：播报文本旋转回归 3/3、相关显示端与文本媒体回归 46/46 通过。
   - 实现文档：docs/spec/display-ui-rotation.md
 - ✅已完成 [2026-08-26][2026-08-26] 修正播报文本汉字字形旋转方向
   - 90°/270°不再使用 `writingMode: vertical-rl` 保持汉字正立，改为对播报文本整体执行 `rotate(90deg)`/`rotate(270deg)`。
   - 保留 0°/180°方向和字号调整，TTS、ASR 共用同一旋转规则。
   - 验证：播报文本旋转回归 3/3、相关显示端与文本媒体回归 46/46 通过。
   - 实现文档：docs/spec/display-ui-rotation.md
 - ✅已完成 [2026-08-26][2026-08-26] 修正旋转后文本布局的宽高交换与位置适配
   - 90°/270°使用交换后的逻辑画布宽高重新计算文本可用区域和四角位置。
   - 连接状态、媒体名、时间、语音状态和播报文本均使用同一套旋转布局约束，并基于 `getBoundingClientRect()` 将实际旋转包围盒对齐到对应四角锚点，避免右侧或底部越界及角落偏移。
   - 内容变化由 `MutationObserver` 触发布局重算，resize 时重新计算旋转布局；状态动画只改变颜色、透明度或阴影，不覆盖旋转变换。
   - 验证：旋转布局回归 7/7、相关显示端与文本媒体回归 41/41、显示端集成回归 9/9 通过。
   - 实现文档：docs/spec/display-ui-rotation.md
 - ✅已完成 [2026-08-26][2026-08-26] 修正90°/270°旋转文本上下位置偏移
   - 按固定定位的 `top`/`bottom`/`left`/`right` 锚点对齐旋转后的实际包围盒，不仅防止越界，也保持文本贴合目标四角。
   - 连接状态、媒体名、时间、语音状态和播报文本统一覆盖 90°/270° 四角位置，锚点误差控制在 1.5px 内。
   - 验证：四角锚点回归 7/7、相关显示端与文本媒体回归 41/41、显示端集成回归 9/9 通过。
   - 实现文档：docs/spec/display-ui-rotation.md
 - ✅已完成 [2026-04-12][2026-04-12] 设备连线指令TTS防抖
   - 改动文件：server.js
   - 功能：executeDeviceEvent 添加30秒防抖，同一IP同一事件不重复执行
   - 修复显示端频繁重连导致重复触发连线指令的问题

## 显示端分布式能力
 - ✅已完成 [2026-04-14][2026-04-14] 显示端能力声明与智能路由
   - 改动文件：server.js, public/display.html, public/js/display-list.js, public/css/upload.css, voice-display-node/main.js, voice-display/main.go, voice-display-cs/VoiceDisplay.cs
   - 功能：显示端连接时自动检测并声明能力（媒体渲染、语音播放、语音录音、语音识别、文本显示）
   - 服务端根据能力路由：TTS只发给有播放能力的显示端，录音只开启有录音能力的显示端
   - 控制端显示端列表展示能力图标，支持手动编辑能力标记
   - 子显示端自动声明为纯语音能力（无媒体渲染、无文本显示）
   - 设计文档：docs/design/display-capability.md
   - 实现文档：docs/spec/display-capability.md

## 显示端代码自动刷新
 - ✅已完成 [2026-08-17][2026-08-17] 显示端代码更新自动 reload（无需重启 APK）
   - 功能：显示端页面（display.html）每 8 秒轮询 `/api/display-version`，返回的 version 变化即执行 `location.reload()` 加载最新代码
   - 前提：APK 已禁用 HTTP 缓存 + URL 带时间戳，reload 即取到最新文件
   - version 计算：服务端取 public 目录下所有文件的 mtime 最大值
   - 本次增强：版本检测由写死的 7 个文件列表改为递归扫描整个 public 目录（含 css/、js/、js/map/** 等子目录），新增任意前端文件都会触发自动刷新，无需手动维护文件清单

## 自动播报开关（媒体文件名 TTS）
 - ✅已完成 [2026-08-17][2026-08-17] 自动播报开关持久化 + 转发修复
   - 问题：控制端「自动播报」关闭后媒体文件名仍会语音播报
   - 根因：服务端 `setAutoTts` 分支只更新 time.announce（整点报时）任务 enabled，未转发显示端 → 显示端 `autoTtsEnabled` 恒为默认 true，播报照常触发
   - 修复：
     - 服务端 `setAutoTts` 分支补 `sendToDisplay(displayId, data)` 转发到显示端（控制端开关立即生效）
     - 同时持久化 `displayData.state.autoTts = enabled` + `config.updateDisplayStateById(displayId, ip, { autoTts })`，显示端刷新/重启后 restoreState 恢复
     - 显示端 `handleRestoreState` 按 `state.autoTts` 恢复（旧数据缺字段则保持当前值，降级安全）
   - 协议/批量联动：`autoTtsEnabled` 仍由批量播放 `announceName` 临时覆盖、结束后恢复（batch-playlist 既有逻辑）
   - 改动文件：
     - src/apps/server/boot/server-app.js（setAutoTts 持久化 + 转发）
     - src/apps/web-mediacenter/ui/public/display.html（handleRestoreState 恢复 autoTts）
     - tests/display-sleep-mode.test.js（+2 步：setAutoTts 同步 / restoreState 恢复 + 旧数据降级；并修时间敏感的 h+1=24 clamp 边界 bug）
     - docs/spec/websocket.md（显示端状态 autoTts + setAutoTts 持久化转发）

## 睡眠模式视频播放守卫
 - ✅已完成 [2026-08-17][2026-08-17] 睡眠模式视频未暂停修复（播放路径缺睡眠守卫）
   - 问题：睡眠模式下视频仍会播放（单视频被点击恢复、批量播放自动切播）
   - 根因：进入睡眠只 `pause()` 一次，但视频播放/恢复路径没有 `isSleepPaused()` 守卫：
     - `document click` 监听：`display:block && paused` 时任何点击页面都 `mediaVideo.play()`（无人值守盒子睡眠中点击遮罩/系统 UI 即恢复，已 puppeteer 实测确证）
     - `keydown` 空格：睡眠中空格切换播放/暂停
     - `handleControl('play', value=true)`：睡眠中控制端发播放命令 resume
     - `playCurrentItem()`（播放列表）：`ended`/`error`/`timer` 触发切播，睡眠中视频持续切播
   - 修复：播放入口统一加 `isSleepPaused()` 守卫；媒体 `play` 事件和低频 watchdog 再次拦截 WebView/原生层延迟续播，睡眠中保持 `paused=true`
   - 验证：puppeteer 实测——进入睡眠后 click/空格/play 命令和延迟 `playVideoAuto()` 均保持 `paused=true`；集成测试 31 步全绿
   - 改动文件：
     - src/apps/web-mediacenter/ui/public/display.html（click/空格/handleControl play/playCurrentItem 加睡眠守卫）
     - tests/display-sleep-mode.test.js（+3 步）
     - docs/spec/display-sleep-mode.md（「睡眠期间视频播放路径守卫」小节）
   - 实现文档：docs/spec/display-sleep-mode.md

## 睡眠模式优先级与下发媒体
 - ✅已完成 [2026-08-18][2026-08-18] 下发媒体取消手动覆盖（临时激活优先级高于 override）
   - 问题：手动覆盖 sleep/deep 后下发媒体，`activateTemporarily()` 只临时压过覆盖 60 秒，激活过期后回落手动覆盖——覆盖状态没有真正被下发媒体取消
   - 修复：`activateTemporarily()`（下发媒体/临时激活入口）同时 `manualSleepMode = null` 取消手动覆盖，媒体正常显示，激活窗口过期后按正常时段判定（不再回落手动覆盖）
   - activateTemporarily 会清理 manualSleepMode，因此下发媒体时两者不会同时有效；当前同时收到立即切换指令时的优先级见下方修复记录。
   - 验证：集成测试 27 步全绿（步骤 13 改为「下发媒体取消手动覆盖，过期不再回落」）
   - 改动文件：
     - src/apps/web-mediacenter/ui/public/display.html（activateTemporarily 清 manualSleepMode + 优先级注释）
     - tests/display-sleep-mode.test.js（步骤 13 断言更新）
     - docs/spec/display-sleep-mode.md（触发流程 + 手动覆盖小节）
   - 实现文档：docs/spec/display-sleep-mode.md

 - ✅已完成 [2026-08-18][2026-08-18] 立即切换指令优先于临时激活窗口
   - 问题：临时激活 60 秒期间执行立即睡眠/深度睡眠/恢复正常，checkSleepMode() 先判断 activationUntil，立即指令无法生效。
   - 修复：sleepOverride 处理时清零 activationUntil；checkSleepMode() 先判断 manualSleepMode，再判断临时激活。
   - 结果：立即手动覆盖 > 临时激活 > 时段判定；临时激活仍会取消手动覆盖并正常触发 60 秒显示。
   - 验证：新增优先级静态回归测试，并在显示端集成测试增加 sleep/deep/normal 三种立即指令场景。
   - 改动文件：
     - src/apps/web-mediacenter/ui/public/display.html
     - tests/display-sleep-priority.test.js
     - tests/display-sleep-mode.test.js
     - docs/spec/display-sleep-mode.md
   - 实现文档：docs/spec/display-sleep-mode.md

## 媒体重连恢复播放进度

 - ✅已确认 [2026-08-21] 暂停媒体重连后恢复上次播放位置
   - 问题：显示端重连恢复 `currentMedia` 时重新加载 video/audio，虽然能恢复暂停状态，但媒体元素的 `currentTime` 被重置为 0；批量播放只恢复当前索引，未恢复当前视频/音频项的时间。
   - 设计：服务端为单媒体保存 `currentMediaProgress`，为非临时批量列表保存当前项 `currentTime`/`duration`；显示端恢复媒体元数据后先 seek 到缓存位置，再按 `isPlaying` 或批量 `state` 决定暂停/播放。
   - 兼容：旧状态缺少进度字段时按 0 秒恢复；图片批量只恢复当前索引；本次不改变 HTML 滚动位置恢复语义。
   - 持久化：进度消息先更新内存状态，按时间节流写入配置；暂停、媒体切换和批量切项时强制写入最新进度，避免高频 `timeupdate` 放大配置文件写入。

## 单个视频循环播放

 - ✅已完成 [2026-08-24][2026-08-24] 修复显示端单个视频播放完后不循环
   - 问题：单个视频播放完后不再循环。
   - 根因：批量播放 `playCurrentItem()` 为推进列表设置 `mediaVideo.loop = false`；`showMedia()` 的单视频和重连恢复分支没有恢复 `loop = true`，因此批量播放后再下发单个视频或重连恢复时继续沿用 false。
   - 修复：`showMedia()` 的 URL/base64 video 分支在 `load()` 前设置 `mediaVideo.loop = true`；批量播放分支继续显式设置 false，依靠 `ended` 切下一项。
   - 验证：新增 `tests/display-video-loop.test.js` 2/2 通过；`tests/display-playback-resume.test.js` 相关回归通过。
   - 任务文档：docs/task/2026-08-24_修复显示端单个视频循环播放.md
   - 实现文档：docs/spec/audio-media.md、docs/spec/batch-playlist.md

## 控制端左侧导航样式
 - ✅已完成 [2026-08-18][2026-08-18] 隐藏左侧导航滚动条但保留滚动能力
   - .sidebar-nav 保留原生垂直滚动，在 Firefox、旧版 Edge、WebKit/Chromium 分别隐藏滚动条视觉元素。
   - 入口数量少时布局不变，入口超出视口时仍可通过滚轮、触控板或触摸滚动访问。
   - 验证：tests/sidebar-layout.test.js 通过。

## 睡眠恢复检查控制端播放/暂停状态
 - ✅已完成 [2026-08-18][2026-08-18] 退出睡眠时视频检查控制端播放/暂停设置
   - 问题：`resumeSleepMedia()` 无条件 `mediaVideo.play()`，睡眠前控制端暂停的视频退出睡眠后自动播放（单媒体 + 播放列表均受影响）
   - 根因：显示端无本地 `mediaIsPlaying` 变量跟踪控制端播放/暂停；`resumeSleepMedia` 只判断媒体元素存在即 play，忽略 `playlistState.paused`
   - 修复：
     - 新增 `mediaIsPlaying` 本地变量：`showMedia` 末尾（`= !paused`）与 `handleControl('play')`（`= value===true`）同步更新；restoreState 恢复 isPlaying 时由 showMedia 一并写入
     - 新增 `shouldPlayMedia()`：播放列表激活时读 `playlistState.paused`，否则读单媒体 `mediaIsPlaying`
     - `resumeSleepMedia()` 开头 `if (!shouldPlayMedia()) return`：控制端暂停的媒体退出睡眠保持暂停
   - 验证：集成测试 30 步全绿（+3 步：睡眠前暂停单媒体/播放列表退出保持暂停、播放中单媒体退出恢复播放，均用真实 mp4）
   - 改动文件：
     - src/apps/web-mediacenter/ui/public/display.html（mediaIsPlaying + shouldPlayMedia + resumeSleepMedia 守卫）
     - tests/display-sleep-mode.test.js（+3 步）
     - docs/spec/display-sleep-mode.md（恢复时检查播放状态小节）
   - 实现文档：docs/spec/display-sleep-mode.md

## 显示端身份与批量状态隔离

- 显示端在线连接使用持久化 `displayId` 作为唯一身份，连接 IP 只用于日志、设备事件和控制端展示。
- 服务器状态持久化改为 `displayStates[displayId]`；旧版按 IP 保存的数据仅在首次带 `displayId` 连接时迁移，迁移后不再以 IP 作为新状态键。
- Agent/测试显示端必须显式使用独立 `displayId`（例如 `agent-local`），真实显示端使用自己的持久 ID；非媒体显示 Agent 不连接 `/display`。
- 显示端批量播放重连时先恢复通用设置，再恢复批量播放列表和断点，确保旋转、适配、裁剪、音量、睡眠和自动播报设置不因批量分支被跳过。
- 控制端切换显示端时清理旧批量面板和临时预览，收到新显示端状态后仅绘制该显示端的批量列表；没有列表时保持隐藏。
