# Web MediaCenter - 未完成任务列表

## 控制端

- ✅已完成 [2026-08-29][2026-08-29] 调整浅色主题大卡片使用 bg-surface
  - 大卡片 `.section` 改用略微调深后的 `bg-surface`；小卡片继续使用 `card-background`，弹窗保持 `bg-surface-strong`。
  - 测试：主题卡片层级测试、主题回归测试和 `git diff --check` 通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-29_浅色主题大卡片改用bg-surface.md`。

- ✅已完成 [2026-08-29][2026-08-29] 降低浅色主题大卡片背景亮度
  - 大卡片 `.section` 改用 `bg-secondary`，避免大面积近白；小卡片和弹窗继续使用原有主题变量。
  - 测试：主题卡片层级测试、主题回归测试和 `git diff --check` 通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-29_浅色主题大卡片背景降低亮度.md`。

- ✅已完成 [2026-08-29][2026-08-29] 修复浅色主题大小卡片背景层级
  - 大卡片 `.section` 使用 `bg-surface`，小卡片 `.control-item` 使用 `card-background`，恢复浅色主题下的层级对比；任务卡片、媒体条目和弹窗保持原语义。
  - 测试：主题卡片层级测试及 UI 主题回归通过，`git diff --check` 通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-29_浅色主题大小卡片层级对比.md`。

- ✅已完成 [2026-08-29][2026-08-29] 调整媒体播放音量滑条布局
  - 主显示控制区的音量滑条移动到媒体播放进度条下面，保留原有 DOM id、事件处理和音量协议；快捷控制面板不变。
  - 测试：媒体控制布局断言、页面脚本语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/control.md`、`docs/spec/upload.md`、`docs/task/2026-08-29_媒体播放音量滑条布局调整.md`。

- ✅已完成 [2026-08-29][2026-08-29] 增加服务端语音识别和语音生成独立开关，关闭后不调用服务器功能
  - 控制端声纹面板增加两个独立开关；关闭后对应服务端按钮禁用，当前服务端设备自动切换到显示端，无显示端能力时不回退服务器。
  - 测试：服务端语音开关测试 3/3 通过，相关 ASR/TTS、显示端和 UI 回归测试通过。
  - 文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/task/2026-08-29_服务器ASR_TTS开关.md`。

- ✅已完成 [2026-08-29][2026-08-29] 修复设备列表监听开关无法关闭并移动语音设备选项
  - 监听复选框绑定 `change` 事件并复用 `updateCapability`；语音识别设备和语音生成设备选项移动到声纹面板，保留原配置接口和 DOM id。
  - 测试：显示端监听、显示列表状态、声纹选项和 UI 回归 26/26 通过；脚本语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/task/2026-08-29_修复设备列表监听开关无法关闭.md`。

- ✅已完成 [2026-08-29][2026-08-29] 显示端 ASR 统一公共入口与提供端选择
  - 浏览器和录音 Android 显示端统一采集 PCM/WAV 并提交 `/api/asr/recognize`；保留“服务端/显示端”选择，显示端模式由服务端按连接顺序转发给第一个 `voiceRecognition=true` 的提供端。
  - 录音端不直接调用自身 ASR；APK 仅在被选为提供端时使用原生 ASR，未对任何 IP 设置优先级。
  - 测试：显示端监听契约 27/27、ASR/Android/主题相关回归 45/45，`zh.wav` 公共接口识别成功，显示端脚本语法检查通过。
  - 文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/design/android-native-asr.md`、`docs/spec/android-native-asr.md`、`docs/task/2026-08-29_显示端ASR统一服务端路径.md`。

- ✅已完成 [2026-08-29][2026-08-29] render-display 设备名左对齐
  - 保留设备名固定宽度和进度条位置，条外标签改为左对齐；`arch0` 与 `SM-N...` 从同一左边缘开始显示，不添加前导空格。
  - 测试：render-display 标签 2/2、旋转布局 1/1 通过，脚本语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/render-display-inline-text.md`、`docs/spec/monitor-system.md`、`docs/task/2026-08-29_render-display设备名左对齐.md`。

- ✅已完成 [2026-08-29][2026-08-29] 服务器 TUI 默认关闭
  - `npm start` 默认不启用 TUI，只有显式传入 `--tui` 才启用；`--no-tui` 继续优先关闭。
  - 测试：服务器启动器、重启脚本和 WebSocket 重连相关测试 12/12 通过，服务端脚本语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/server-restart-script.md`、`docs/spec/server-restart-script.md`、`docs/task/2026-08-29_服务器TUI默认关闭.md`。

- ✅已完成 [2026-08-29][2026-08-29] 服务器双进程启动器与控制台重启
  - 新增前台启动器监管 server-app 子进程，继承控制台标准流和 IPC；服务器重启后复用同一控制台 TTY，不再 detached 到后台。
  - `/api/restart` 通过 IPC 通知启动器，重启前关闭 WebSocket、TUI 和受管运行时；普通 SIGINT/SIGTERM 不自动拉起，异常退出最多延迟重启 5 次。
  - 测试：`tests/server-launcher.test.js`、重启脚本配置、显示端 WebSocket 重连共 11/11 通过，两个入口语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/server-restart-script.md`、`docs/spec/server-restart-script.md`、`docs/task/2026-08-29_服务器双进程启动器与控制台重启.md`。

- ✅已完成 [2026-08-29][2026-08-29] 过滤 renderUpdate 高频命令提示
  - 显示端对 `task:renderUpdate` 和兼容 `hardwareStats` 仅更新渲染任务，不再发送 `commandAck`，避免控制端持续弹出 Tips。
  - 播放、控制、TTS、提醒等显式命令确认保持不变。
  - 测试：新增 `tests/display-render-update-ack.test.js`，覆盖高频分支无回执及显式播放命令保留回执。
  - 文档：`docs/design/monitor-system.md`、`docs/spec/monitor-system.md`、`docs/spec/websocket.md`、`docs/task/2026-08-29_renderUpdate提示过滤.md`。

- ✅已完成 [2026-08-29][2026-08-29] 显示端文字增加半透明主题色斜向投影
  - render-display 进度条外标签、显示端时间文本和媒体名统一使用固定白字、黑色阴影和正下方 2px 无模糊主题色投影。
  - 不支持 `color-mix()` 时回退纯色主题投影，不使用文字轮廓或元素盒子内阴影，避免矩形框和额外底部投影；进度条及条内数值保持不变。
  - 测试：render-display 标签、显示端主题同步、旋转布局和控制端主题回归通过。
  - 文档：`docs/design/render-display-inline-text.md`、`docs/design/control-ui-theme.md`、`docs/spec/monitor-system.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-29_render-display标签主题色半透明描边.md`。

- ✅已完成 [2026-08-29][2026-08-29] render-display 进度条外标签增加半透明主题描边
  - 设备名、`M`、`GPU`、`VRAM` 等进度条外标签恢复固定白字与黑色阴影，增加 1px 当前主题强调色描边。
  - 描边使用 65% 半透明 `color-mix()`，不支持时回退纯色主题描边；进度条和条内数值保持不变。
  - 测试：render-display 标签、旋转布局和主题回归 23/23 通过，脚本语法检查通过。
  - 文档：`docs/design/render-display-inline-text.md`、`docs/spec/monitor-system.md`、`docs/task/2026-08-29_render-display标签主题色半透明描边.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端媒体底色固定黑色
  - 显示端 `html/body`、媒体容器和媒体睡眠遮罩恢复固定黑色，媒体画面后方不再随控制端主题切换。
  - 连接状态、文本媒体、天气/语音弹窗和任务提示仍继续使用主题变量。
  - 测试：显示端主题同步回归和控制端主题回归 21/21 通过，主题脚本语法检查通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_显示端媒体底色固定黑色.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端时间和媒体名增加主题色外描边
  - 时间和媒体名恢复固定白色文字与固定黑色阴影，新增 1px 当前主题强调色外描边。
  - 测试：显示端主题同步回归 2/2 通过，主题脚本语法检查通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_显示端时间文本外描边.md`。

- ✅已完成 [2026-08-28][2026-08-28] 基础主题色与控件继承
  - 显示端信息弹窗、浏览器详情、设备树和树状控件改用基础主题变量或继承父级文字颜色，减少白字、灰字和深色背景与浅色主题冲突。
  - 在线、支持/不支持、选中和危险操作继续保留语义色；输入框、下拉框和滑条使用主题控件变量。
  - 测试：`tests/ui-theme.test.js` 主题回归 19/19 通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_基础主题色与控件继承.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端透明背景与服务启动修复
  - 修复主题同步后连接状态、天气弹窗和文本背景透明，以及 `config-app-service.js` 导出未定义主题函数导致的服务启动崩溃。
  - 配置服务模块正确引入并导出 `normalizeControlTheme`；显示端关键 UI 表面统一使用不透明 `--bg-secondary`。
  - 测试：配置服务、主题同步、显示端旋转/播放恢复和文本媒体相关回归 45/45 通过；脚本语法检查和 `git diff --check` 通过。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_显示端透明背景与服务启动修复.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端文件变化轮询调整为 30 秒
  - 显示端 `/api/display-version` 成功检查和失败重试统一改为每 30 秒执行；控制端保持无独立文件变化轮询。
  - 测试：版本变化、成功间隔、失败重试和控制端无轮询检查通过。
  - 文档：`docs/design/display.md`、`docs/spec/api.md`、`docs/task/2026-08-28_显示端文件变化轮询改为30秒.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端语音唤醒与监听控制
  - 控制端按显示端关闭语音监听；关闭声纹识别时仍支持 ASR、唤醒词和对话；TTS 完成后计时 3 分钟，超时重新等待唤醒。
  - 改动：`src/apps/server/boot/server-app.js`、`src/apps/server/modules/voice/display-voice-conversation.js`、`src/apps/web-mediacenter/ui/public/display.html`、`src/apps/web-mediacenter/ui/public/js/display-list.js`、`tests/display-voice-conversation.test.js`、`tests/display-voice-listening.test.js`。
  - 文档：`docs/design/display-voice-conversation.md`、`docs/spec/display-voice-conversation.md`、`docs/task/2026-08-28_显示端语音唤醒监听控制.md`。

- ✅已完成 [2026-08-28][2026-08-28] 显示端主题同步
  - 显示端 UI 跟随服务端全局主题，适配背景、文本媒体、状态文字、语音/任务提示和临时弹窗；图片、视频和网页媒体内容保持原样。
  - 服务端通过 WebSocket 广播主题变更，显示端连接和重连时接收当前主题；共享 15 种主题配色。
  - 测试：主题、显示端同步、旋转弹窗、文本媒体和播放恢复相关回归 44/44 通过；脚本语法检查和 `git diff --check` 通过。
  - 改动：`src/apps/server/boot/server-app.js`、`src/apps/web-mediacenter/ui/public/display.html`、`src/apps/web-mediacenter/ui/public/css/display.css`、`src/apps/web-mediacenter/ui/public/js/ui-theme.js`、`tests/display-theme-sync.test.js`、`tests/ui-theme.test.js`。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_显示端主题同步.md`。

- ✅已完成 [2026-08-28][2026-08-28] 主题服务端持久化与天气响应弹窗旋转适配
  - 服务端保存控制端全局主题，控制端保留本地缓存回退；显示端天气响应弹窗随 0/90/180/270 度旋转并按逻辑画布限制尺寸。
  - 改动：`src/apps/server/modules/config/control-theme-config.js`、`src/apps/server/modules/config/config-app-service.js`、`src/apps/server/boot/server-app.js`、`src/apps/web-mediacenter/ui/public/js/ui-theme.js`、`src/apps/web-mediacenter/ui/public/upload.html`、`src/apps/web-mediacenter/ui/public/display.html`、`src/apps/web-mediacenter/ui/public/css/display.css`。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_主题服务端持久化与天气弹窗旋转适配.md`。

- ✅已完成 [2026-08-28][2026-08-28] 扩展控制端主题配色
  - 新增薄荷青、海洋蓝、森林绿、极简灰、藻盐、少女粉、玫瑰金和新年红，控制端共支持 15 种主题；藻盐采用盐白与藻绿配色，少女粉使用更明亮的粉红层级。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_控制端多主题配色.md`。

- ✅已完成 [2026-08-28][2026-08-28] 修复浅色主题 toggle 与 LLM/系统路由按钮选中态
  - 自定义 toggle 的关闭态使用浅灰轨道和边框，开启态使用主题强调色与白色滑块；原生复选框/单选框同步使用主题强调色。
  - 设置页天气/搜索的 LLM 与系统按钮通过 `active` class 区分，浅色主题下未选中项使用浅色背景，选中项使用主题渐变和外框。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_浅色主题toggle选中态修复.md`。

- ✅已完成 [2026-08-28][2026-08-28] 修复显示控制面板 toggle/状态按钮浅色选中态
  - 画面填充、裁剪旋转、中心缩放和主/浮动控制的播放状态统一区分未选中、选中、播放中和暂停状态。
  - 浅色主题未选中使用浅色背景与边框，选中使用主题强调色，播放/暂停使用成功色/危险色。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_显示控制toggle选中态修复.md`。

- ✅已完成 [2026-08-28][2026-08-28] 补齐控制端其他状态按钮的浅色选中态
  - 语音识别/生成设备、自动播报、文本播放和批量播放同步 `active`/`playing`/`paused` 状态 class。
  - 设备选择模式、日志筛选/自动滚动和任务选项统一区分浅色主题下的未选中与选中状态。
  - 文档：`docs/design/control-ui-theme.md`、`docs/spec/ui-theme.md`、`docs/task/2026-08-28_控制端其他状态按钮选中态修复.md`。

## Android ASR APK

- ✅已完成 [2026-08-29][2026-08-29] 删除 ASR 其他文字过滤开关及处理链路
  - 测试 APK、正式 Display APK、控制端和服务端均移除 `filterOtherText` 与 `zh-en-filter`；保留普通语言选择、降噪、快速多段和流式 ASR。
  - 相关 Node/Android 测试及正式 APK 构建通过；详细任务见 `docs/task/2026-08-29_删除ASR其他文字过滤.md`。

- ✅已完成 [2026-08-29][2026-08-29] 控制端显示端列表独立展示监听状态和最近 ASR 文本
  - 每个显示端直接提供监听开关，显示监听中/等待唤醒/已关闭/不可用和最近识别结果；详细任务见 `docs/task/2026-08-29_显示端监听状态与最近识别文本.md`。

- ✅已完成 [2026-08-28][2026-08-28] 统一控制端、显示端和子显示端录音为原始 PCM/WAV
  - 控制端语音输入、声纹注册、正式显示端和独立 `ttslive` 网页统一使用 WebAudio 原始 PCM，重采样为 16 kHz mono 后封装 WAV。
  - Node 子显示端继续使用 16 kHz WAV 录音器，Go/C# 子显示端继续上传 `audio.wav`；网页端不再使用 MediaRecorder/WebM。
  - 网页录音契约测试 8/8 通过，包含文件名、MIME、采样率和所有入口无 MediaRecorder 检查。
  - 详细任务：`docs/task/2026-08-28_APK内存不足ASR重连与正式识别准确度修复.md`。

- ✅已完成 [2026-08-28][2026-08-28] 修复正式 APK ASR 内存不足重连并对齐测试 APK 音频链路
  - 默认仍按当前 CPU 核心数创建 recognizer；可用内存不足以承载完整池时回退为单实例，构造 OOM 时释放已创建 slot 后重试单实例。
  - 单实例仍无法加载时进入内存错误终态，显示端撤销 `voiceRecognition`、停止录音且不再重复 `asrEnsureModel`，WebSocket 保持连接。
  - APK 本地 ASR 录音改用原始 PCM/WAV，关闭浏览器回声消除和噪声抑制请求参数；普通浏览器和服务端 ASR 同样使用 WAV。
  - Android JVM 全量单测、网页契约测试、Debug APK 构建、SM-N9500 安装启动验证通过；启动后进程保持运行，无 FATAL/OOM/ASR 重连日志。
  - 详细任务：`docs/task/2026-08-28_APK内存不足ASR重连与正式识别准确度修复.md`。

- ✅已完成 [2026-08-28][2026-08-28] 将测试 APK 的 ASR 增强能力接入正式 Display APK
  - 正式 APK 接入普通非流式 ASR 的语言选择、GTCRN 降噪开关、中英双语过滤和 Sherpa 快速多段声纹识别；快速多段支持 AUTO 或 1～5 人。
  - 网页、服务端配置和显示端 WebSocket 全链路透传；流式 ASR 不接入，服务端 ASR 路径不执行 GTCRN/快速多段。
  - Android JVM 全量单测、Node 契约测试、网页/服务端语法检查和 `npm run build:apk` 通过。
  - 详细任务：`docs/task/2026-08-28_正式APK接入测试APK的ASR增强功能.md`。

- ✅已完成 [2026-08-28][2026-08-28] 测试 APK 增加当前音频播放和中英混合识别后过滤
  - 原生 APK、测试网页均可播放当前选择/录制音频；网页离线 ASR 增加自动、中文、英文和中英混合过滤选项。
  - `zh-en-filter` 保留中文 Han、英文、数字和常用标点，删除日文假名、韩文等其他脚本；不区分共享 Han 字符。
  - JVM 单测、网页脚本语法检查、Debug APK 构建和真机安装通过；设备锁屏导致原生播放按钮未完成手工点击验证。
  - 详细任务：`docs/task/2026-08-28_测试APK当前音频播放与中英混合过滤.md`。

- ✅已完成 [2026-08-27][2026-08-27] 独立声纹测试 APK 增加降噪开关
  - 单段、普通多段、快速多段和声纹注册统一支持 Sherpa GTCRN 降噪；流式 ASR 不接入。
  - 真机验证 `zh.wav` 注册、单段、普通多段、快速多段均返回 `denoise:true` 和匹配 `ZH`；GTCRN 模型加载正常。
  - 详细结果：`docs/task/2026-08-27_独立APK声纹测试降噪开关.md`。

- ✅已完成 [2026-08-27][2026-08-27] Sherpa 快速多段支持最多 5 人
  - 新增 `SHERPA_MULTI_FAST`，支持 `AUTO` 或实际人数 `1–5`，明确人数时减少重复 embedding 推理。
  - 真机 `zh-en.wav` 快速 2 人模式约快 6.1%；详细结果见 `docs/task/2026-08-27_Sherpa快速多段人数上限5.md`。

- ✅已完成 [2026-08-27][2026-08-27] Sherpa 单段/多段真机速度复测
  - 在 SM-N9500 上完成四个 WAV 的两种流程共 8 次 HTTPS 测试；单段 `5.745–14.335s`，多段 `5.553–31.683s`。
  - 单语音频多段只有一个分段，速度接近单段；中英串接/混合多段约慢 `2.21/1.76` 倍。
  - 详细结果：`docs/task/2026-08-27_Sherpa单段多段速度复测.md`。

- ✅已完成 [2026-08-27][2026-08-27] 补充 Sherpa 混合语音处理验证
  - `zh-en-mix.wav` 多段能识别重叠的 ZH/EN cluster，但不进行语音源分离，两个分段 ASR 均以英文为主。
  - 详细结果：`docs/spec/android-voiceprint-test-apk.md`。

- ✅已完成 [2026-08-27][2026-08-27] 独立 ASR APK 增加 Sherpa 流式 ASR
  - 内置官方小型双语 Zipformer int8 模型，新增 `OnlineRecognizer`、WebSocket `/api/asr/stream` 和浏览器麦克风实时 partial/final 文本显示。
  - 真机 `192.168.1.6:5555` 返回 `streamingReady:true`；使用 `zh.wav` 分片发送收到 29 个流式文本帧并正常 final，离线 `/api/asr` 回归正常。
  - Android JVM 单测、Debug APK 构建、APK 安装和 WebSocket 握手/PCM 分片验证通过。
  - 文档：`docs/design/android-voiceprint-test-apk.md`、`docs/spec/android-voiceprint-test-apk.md`、`docs/task/2026-08-27_独立APK仅保留Sherpa声纹测试.md`

- ✅已完成 [2026-08-27][2026-08-27] 独立 ASR APK 增加 HTTPS/WSS
  - 使用独立测试 TLS 证书（SAN：`192.168.1.6`、`localhost`），不复用 display APK Android 签名证书；APK 默认通过 HTTPS 提供网页，流式 ASR 自动使用 WSS。
  - 真机界面显示“HTTPS 证书已就绪”；`curl -k https://192.168.1.6:18080/health` 和加密 WebSocket partial/final 验证通过。
  - 文档：`docs/design/android-voiceprint-test-apk.md`、`docs/spec/android-voiceprint-test-apk.md`、`docs/task/2026-08-27_独立APK仅保留Sherpa声纹测试.md`

- ✅已完成 [2026-08-27][2026-08-27] 复测 HTTPS/WSS 流式 ASR 中文和英文音频
  - `zh.wav` 返回 28 个 partial 和 final；`en.wav` 返回 36 个 partial 和 final，WSS 链路正常。
  - 当前双语 Zipformer 文本准确率偏低，记录为后续模型优化事项。

- ✅已完成 [2026-08-26][2026-08-26] 新增独立 Android 离线语音识别 APK
  - 内置 SenseVoice int8 模型，支持录音、选择音频、识别文本、识别耗时和自动/大核/小核 CPU 模式。
  - 提供 `0.0.0.0:18080` 的普通网页，支持选择 WAV、网页录音和识别耗时；页面内部使用 `/health`、`/api/asr`。
  - 文档：`3rd/tts-server/docs/design/android-asr-apk.md`、`3rd/tts-server/docs/spec/android-asr-apk.md`、`3rd/tts-server/docs/task/2026-08-26_独立Android离线语音识别APK.md`

## TTS

- ✅已完成 [2026-08-29][2026-08-29] 接入显示端 CPU 拓扑回报与 TTS 双路生成
  - Display APK 通过 cpuStatus 回报实际 topology 和 TTS policy；文本媒体、普通 Chat、旧版 Chat、手动 TTS、Agent TTS 按实际槽位最多同时生成两句，播放保持句序。
  - 测试：CPU 协议 3/3、文本 TTS 28/28、有序调度器/Chat/手动 TTS/Agent 回归 9/9、Android JVM 单测和 Debug APK 构建通过。
  - 真机复测：跳过 `？` 后只生成两段，当前 APK 未回报 cpuStatus，串行总耗时约 2966ms，未再触发服务端回退。
  - 已完成：所有 TTS 入口跳过仅标点分句，避免无效合成和服务端回退；文本媒体通过可定位通知继续播放。
  - 任务记录：docs/task/2026-08-29_显示端CPU拓扑回报与TTS并发.md。

- ✅已完成 [2026-08-29][2026-08-29] 收敛 TTS 连续仅标点分句
  - 连续仅标点分句只保留第一个，删除后续分句；`喵呜……？！ （耳朵瞬间变得通红` 不再为 `！` 单独生成 TTS 音频。
  - 保持省略号句间边界、小数点和普通英文句号的既有行为。
  - 文档：`docs/design/tts.md`、`docs/spec/tts.md`、`docs/task/2026-08-29_TTS省略号停顿缩短.md`。

- ✅已完成 [2026-08-26][2026-08-26] 增加 ASR/TTS 独立优先大核开关
  - `cpuAffinity` 为 ASR、TTS 分别增加 `preferBigCores`；开启时保持并发槽位总数并优先填充大核，不足时小核补齐。
  - `upload.html` / `tts.js` 增加两个独立开关，服务端 API、WebSocket 广播和 APK `CpuTopology` 全链路透传。
  - Node 25/25、Android JVM、APK 构建、匹配签名安装和 display2 启动验证通过；当前设备两个开关均已开启。
  - 文档：`docs/design/android-native-tts.md`、`docs/design/android-display.md`、`docs/design/control.md`、`docs/spec/android-native-tts.md`、`docs/spec/android-display.md`、`docs/spec/upload.md`、`docs/task/2026-08-26_ASR与TTS优先大核开关.md`。

- ✅已完成 [2026-08-26][2026-08-26] 修复 APK 生成 TTS 时页面卡顿
  - `display.html` 的 `cpuConfig` 改为去重后调用异步 `cpuConfigureAsync`；浏览器和旧 APK 缺少异步桥时安全忽略，不再同步阻塞 WebView。
  - `NativeBridge` 后台合并最新 CPU 配置；ASR/TTS policy 不变时复用现有 pool；声纹模型回调统一切回 WebView 主线程。
  - 回归验证：新增 TTS 页面卡顿契约 3/3、相关 Node 测试 21/21、Android JVM 单测和 `npm run build:apk` 均通过。
  - 部署验证：使用匹配 debug keystore 通过 `adb push` + `pm install -r` 安装到 `192.168.1.6:5555`，display 2 前台运行，PID 18703 存活。
  - 运行参数：ASR/TTS 均调整为 `2 大核 + 0 小核`，服务器配置接口返回成功。
  - 文档：`docs/design/android-native-tts.md`、`docs/design/android-display.md`、`docs/spec/android-native-tts.md`、`docs/spec/android-display.md`、`docs/task/2026-08-26_APK生成TTS页面卡顿修复.md`。

- ✅已完成 [2026-08-26][2026-08-26] 完成 APK 大小核并发配置集成验证（Task 6）
  - Node 集成回归 22/22、Android JVM 单测和 assembleDebug、npm APK 安装、display2 启动均通过。
  - 默认 ASR/TTS `1 大核 + 1 小核` 下，真机同时提交 3 个 TTS 请求均收到 `ttsGenerating`/`ttsResult`，无失败、超时或重复播放错误。
  - 本轮未重新采集 PSS/native heap 和 affinity syscall 成功率，详细结果见 `.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-6-report.md`。

- ✅已完成 [2026-08-26][2026-08-26] 修复 APK CPU affinity Display/Control UI review：保存按钮重复绑定
  - `upload.html` 移除 `cpuAffinitySaveBtn` 的内联 `onclick`，保留 `tts.js` 中 `CpuAffinitySettings.init()` 的单一 click listener，避免一次点击触发两次 `POST /api/config/cpuAffinity`。
  - `tests/apk-cpu-affinity-display.test.js` 新增 `Tts.init() + button.click()` 集成回归，覆盖一次点击只发一次 POST、重复 `init()` 不重复绑定、且 `loadConfig()` 仍在初始化时执行。
  - 文档：`docs/task/2026-08-25_APK大小核并发配置.md`、`.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-5-fix-report.md`。

- ✅已完成 [2026-08-26][2026-08-26] 完成 APK CPU affinity Display/Control UI（Task 5）
  - `display.html` 新增 `cpuConfig` 消费，只在 `NativeDisplay.cpuConfigure` 可用时透传给 APK；浏览器显示端和旧桥安全忽略，不改变现有 ASR/TTS 路由与旧 APK fallback。
  - `upload.html` 增加 ASR/TTS 大核/小核数量输入与保存按钮；`tts.js` 新增 `CpuAffinitySettings`，负责 `GET/POST /api/config/cpuAffinity`、非负整数规范化、任一引擎至少一个槽位兜底和状态文案。
  - `websocket.js` 新增 `cpuAffinityChanged` 回填链路；新增回归 `tests/apk-cpu-affinity-display.test.js` 覆盖显示端桥兼容、控制页控件、读取/保存/广播更新。
  - 文档：`docs/design/control.md`、`docs/spec/upload.md`、`docs/design/android-display.md`、`docs/spec/android-display.md`、`docs/task/2026-08-25_APK大小核并发配置.md`、`.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-5-report.md`。

- ✅已完成 [2026-08-25][2026-08-25] 修复 Task 1 review：CPU affinity 必须对 ASR/TTS 各自保留至少一个槽位
  - `POST /api/config/cpuAffinity` 对任一引擎显式 `0/0` 返回 400，不保存、不广播。
  - 规范化与 `cpuConfig` 输出路径会把存量残缺或持久化 `0/0` 引擎回退到该引擎默认 `1 大核 + 1 小核`。
  - 回归测试：`tests/apk-cpu-affinity-config.test.js`。
  - 文档：`docs/design/android-native-tts.md`、`docs/spec/android-native-tts.md`、`docs/task/2026-08-25_APK大小核并发配置.md`。

- ✅已完成 [2026-08-25][2026-08-25] APK ASR/TTS CPU affinity 服务器配置契约（Task 1）
  - 服务器新增 `GET/POST /api/config/cpuAffinity`、`cpuAffinityChanged` 控制端广播和 `cpuConfig` 显示端广播；默认值为 ASR/TTS 各 `1 大核 + 1 小核`。
  - `config-app-service.js` 统一处理 CPU affinity 规范化、缺失字段回填和非法值拒绝；显示端首连初始化路径同步下发 `cpuConfig`。
  - 回归测试：`tests/apk-cpu-affinity-config.test.js`。
  - 文档：`docs/design/android-native-tts.md`、`docs/spec/android-native-tts.md`、`docs/task/2026-08-25_APK大小核并发配置.md`。

- ✅已完成 [2026-08-25][2026-08-25] Android TTS APK 增加自动/大核/小核 CPU 模式
  - CPU 模式通过 Spinner 选择并持久化；TTS 工作线程在模型加载/合成前应用动态 affinity，失败时回退自动。
  - 文档：`3rd/tts-server/docs/design/android-tts-cpu-affinity.md`、`3rd/tts-server/docs/spec/android-tts-cpu-affinity.md`、`3rd/tts-server/docs/task/2026-08-25_Android-TTS-CPU核心模式.md`

- ✅已完成 [2026-08-25][2026-08-25] 新增独立 Android 离线 TTS APK
  - `3rd/tts-server/android-tts/` 内置 Xiaoxiao 模型，提供文本框、生成按钮、自动播放和 SDK 合成耗时显示。
  - `SpeechSynthesizer(config, null)` 禁止默认扬声器输出；`npm --prefix 3rd/tts-server run build:android-tts`、Android JVM 单元测试和 APK 静态检查通过。
  - 文档：`3rd/tts-server/docs/design/android-offline-tts-apk.md`、`3rd/tts-server/docs/spec/android-offline-tts-apk.md`、`3rd/tts-server/docs/task/2026-08-25_独立Android离线TTS-APK.md`

- ✅已完成 [2026-08-25][2026-08-25] 增加显示端 TTS 开始生成回执
  - 显示端收到 `ttsGenerate` 后回 `ttsGenerating`；服务端 3 秒未收到即回退服务器，收到后继续等待最终 `ttsResult`，总超时保持 60 秒。
  - 显示端断开时立即结束 pending TTS 请求；最终回包必须先经过开始回执校验。
  - 回归测试：tests/tts-display-routing.test.js。
  - 文档：docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/design/tts.md、docs/spec/tts.md、docs/task/2026-08-25_TTS开始生成回执与3秒确认.md

- ✅已完成 [2026-08-25][2026-08-25] 所有服务端 TTS 生成统一显示端优先路由
  - API、聊天、Agent、文本媒体、语音指令、提醒和整点报时统一经过 `generateTtsWithFallback()`；显示端失败时自动回退服务器。
  - TaskManager 向内置任务注入统一 TTS 函数，移除整点报时对底层 `tts.generateTTS()` 的直接依赖。
  - 回归测试：tests/tts-display-routing.test.js。
  - 文档：docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_所有TTS生成统一显示端路由.md

- ✅已完成 [2026-08-25][2026-08-25] 调查 `3rd/tts-server` Wine TTS 100 字长稳压测中的 RSS 增长
  - 确认常驻 synthesizer 复用会加剧 SDK native RSS；Wine worker 默认每 10 个 S 请求在当前 HTTP 任务完成后重启，避免请求队列/旧任务竞态。
  - 残余首次合成 footprint 与详细数据记录在 `3rd/tts-server/docs/task/2026-08-25_tts-wine-rss-stability.md`。

## 文本媒体

- ✅已完成 [2026-08-27][2026-08-27] 修复无播放设备时文本媒体快速翻页
  - 根因：无可用 `voicePlayback` 设备时，服务端错误被播放器立即当作句子完成处理，连续触发分页。
  - 服务端错误增加 `errorCode: noVoicePlaybackDevice`；显示端按每秒 3 个有效字符延时推进，并在播放操作失效时清理回退计时器。
  - 有语音设备和 TTS 合成失败等其他错误路径保持原有语义；文本媒体相关回归 84/84 通过。
  - 文档：`docs/design/text-media-routing.md`、`docs/spec/text-media-routing.md`、`docs/task/2026-08-27_无播放设备文本媒体按字数翻页.md`。

- ✅已完成 [2026-08-26][2026-08-26] 修复文本媒体 TTS 固定旧设备且仅从选中设备选择
  - 每个实际句子 TTS 请求重新检查全部在线且启用 `voicePlayback` 的显示端；源端不可播时允许选择未被媒体选中的语音设备，句间设备状态变化可动态切换目标。
  - 预取句沿用当前句实际语音目标；目标失效时取消预取，实际下一句重新选择设备；远程句子完成回执按本句实际目标校验。
  - 新增未选设备、句间切换、目标失效时取消预取和能力变化竞态回归。
  - 文档：`docs/design/text-media-routing.md`、`docs/spec/text-media-routing.md`、`docs/task/2026-08-26_文本媒体TTS动态选择全部设备.md`。

- ✅已完成 [2026-08-24][2026-08-24] 修复最终审查发现的远程 TTS 生命周期边界
  - 批量 pause/prev/next/jump 取消远程上下文并保留 route；远程目标断连/超时回传可定位错误并清理预取；服务重启恢复文本 route；远程预取句暂停后恢复重新请求当前句；超时后迟到预取不再下发。
  - 明确 `mediaTypes` 混合未知值规则：保留合法类型，全部无效才回退全选。
  - 测试：核心相关回归 55/55 通过。

- ✅已完成 [2026-08-24][2026-08-24] 完成 Task 4：文档、回归与交付检查
  - 复核 `docs/design/text-media-routing.md`、`docs/spec/text-media-routing.md`、任务文档与当前实现，确认 Task 1/2/3 的服务器权威 `mediaTypes`、手动 `voicePlayback` 路由、远程回执、单句预取与 stop/cancel 失效语义一致。
  - 执行指定 Node 测试集合 90 项，90 项全部通过；此前的环境写盘错误和过时断言已重新验证。
  - 验证：相关 `node --check`、`git diff --check`，以及 `.superpowers/sdd/2026-08-24-text-media-routing/task-4-implementation-report.md`。
  - 最终复核：完整相关测试集合 98/98 通过，最终只读审查 CLEAN。
  - 文档：docs/design/text-media-routing.md、docs/spec/text-media-routing.md、docs/task/2026-08-24_批量媒体筛选与文本TTS路由预生成.md、changelog.md、.superpowers/sdd/2026-08-24-text-media-routing/task-4-implementation-report.md

- ✅已完成 [2026-08-24][2026-08-24] 完成 Task 3：下一句 TTS 预生成与显示端缓存
  - `text-media-player.js` 在当前句音频开始后单次请求下一句 `prefetch:true`，预取回包只缓存不抢播。
  - 当前句结束优先消费缓存；预取未完成时等待，预取失败后回退普通请求，不跳过当前句。
  - 暂停、翻页、停止和新 `playbackId` 清理本地预取槽并忽略旧回包。
  - `text-media-tts-service.js` 识别/透传 `prefetch`，每个播放上下文最多一个预取槽；本地、远程和错误回包均保留定位字段。
  - `display.html` 兼容远程 `prefetch` 单槽缓存和 `textSentenceTtsReady`，不改变旧无 `prefetch` 客户端行为。
  - Task 3 review-fix：源端取消、路由覆盖、清理 route 或新 `playbackId` 会向远程语音目标发送可定位 `textPlaybackRemote/action:stop`，远程端清理当前音频和预取槽，旧回调不能再消费缓存。
  - 测试：`tests/text-media-player.test.js`、`tests/text-media-tts-service.test.js`、`tests/text-media-server-integration.test.js`、`tests/text-media-integration.test.js`。
  - 文档：docs/design/text-media-routing.md、docs/spec/text-media-routing.md、docs/task/2026-08-24_批量媒体筛选与文本TTS路由预生成.md、.superpowers/sdd/2026-08-24-text-media-routing/task-3-implementation-report.md、.superpowers/sdd/2026-08-24-text-media-routing/task-3-fix-report.md

- ✅已完成 [2026-08-24][2026-08-24] 完成 Task 2：手动语音设备路由与远程播放回执
  - `display-list.js`、`device-list.js` 复用能力编辑器并明确 `voicePlayback` 是“语音播放为手动路由开关”，未新增自动无扬声器上报。
  - `server-app.js` 在 `mediaBatch` 和 `playlistRequest` 中为文本媒体计算并持久化 `selectedDisplayIds`、`selectedVoiceDisplayIds`、`voiceTargetDisplayId`、`voiceRouteByDisplayId`。
  - `text-media-tts-service.js`、`text-media-ws-integration.js`、`text-media-player.js`、`display.html` 支持远程 `textPlaybackRemote`、`textSentenceTtsFinished` 回执校验和取消后上下文失效。
  - Task 2 reviewer fix：`server-app.js` 注册服务器计算 route 为 TTS 权威上下文；`text-media-tts-service.js` 使用 pendingRemoteSentences 校验远程句子定位后再转发回执。
  - 测试：`tests/text-media-tts-service.test.js`、`tests/text-media-server-integration.test.js`、`tests/text-media-player.test.js`、`tests/text-media-integration.test.js`。
  - 文档：docs/design/text-media-routing.md、docs/spec/text-media-routing.md、.superpowers/sdd/2026-08-24-text-media-routing/task-2-implementation-report.md

- ✅已完成 [2026-08-24][2026-08-24] 修复 Task 1 reviewer fix 引入的临时批量上传索引回归
  - `src/apps/web-mediacenter/ui/public/js/upload.js` 恢复使用当前循环索引生成 `tempPreviewKey`，避免 `prepareTempFiles()` 引用未定义 `i` 后整批临时播放请求不发出。
  - `tests/text-media-routing-task1.test.js` 新增最小执行型回归，覆盖 `prepareTempFiles()` 和 `showBatchTempUpload()` 的批量入口链路。
  - 文档：docs/design/text-media-routing.md、docs/spec/text-media-routing.md、.superpowers/sdd/2026-08-24-text-media-routing/task-1-fix2-report.md

- ✅已完成 [2026-08-23][2026-08-23] 混合播放列表文本接入
  - `display.html` 绑定 TextMediaPlayer 列表上下文，文本末页才推进列表，并清理旧句子播放。
  - `server-app.js` 保存并恢复非临时列表的文本页/句子/格式进度；临时 base64 不落盘。
  - 控制端批量进度面板显示文本文件页码；新增 mixed playlist focused tests。

## 聊天系统

- ✅已完成 [2026-08-28][2026-08-28] 修复控制端聊天群聊页签无效并增加模式退出按钮
  - 群聊页签现在可从私聊或工作组模式返回群聊；私聊显示“退出私聊”，工作组显示“退出工作组”。
  - 改动：`src/apps/web-mediacenter/ui/public/js/chat.js`；测试与文档已同步。

- ✅已完成 [2026-08-23][2026-08-23] Pi Agent 在 LLM 高级指令路由下跳过旧命令识别
  - `llm + Pi Agent` 跳过天气/搜索旧多处理器；`system` 路由和普通 LLM 行为保持不变
  - 文档：docs/design/llm-agent-mode.md、docs/design/chat-system.md、docs/spec/llm-agent-mode.md、docs/spec/chat-system.md、docs/task/2026-08-23_Pi-Agent跳过LLM路由旧命令识别.md

- ✅已完成 [2026-08-23][2026-08-23] Pi Agent 默认请求超时调整为 600 秒
  - PiRuntimeManager 默认 RPC 请求超时从 120 秒调整为 600 秒；保留测试注入短超时和超时清理逻辑
  - 文档：docs/design/llm-agent-mode.md、docs/spec/llm-agent-mode.md、docs/task/2026-08-23_Pi-Agent默认超时调整为600秒.md

- ✅已完成 [2026-08-23][2026-08-23] 修复 Pi Agent 空 Key 无回复与 Claude 默认超时
  - Claude 默认无输出超时调整为 600 秒；Pi 本地兼容接口空 Key 使用占位 Key，通过 provider 校验并正常请求
  - 文档：docs/design/llm-agent-mode.md、docs/spec/llm-agent-mode.md、docs/task/2026-08-23_修复Claude超时与Pi空Key.md

- ✅已完成 [2026-08-23][2026-08-23] 修复 Agent 测试清空私聊模板导致重启后历史不可见
  - 测试模板改为只更新内存；恢复小爱、妲己私聊模板入口，保留原有历史文件和会话
  - 文档：docs/design/chat-system.md、docs/spec/chat-system.md、docs/task/2026-08-23_修复测试污染私聊模板.md

- ✅已完成 [2026-08-22][2026-08-22] 服务器 TTS 按调用方检查显示端睡眠
  - 普通聊天、Agent、手动 TTS、提醒和语音指令不受睡眠模式影响；整点报时通过 `checkSleep=true` 按目标显示端状态跳过睡眠/深度睡眠设备
  - 改动：服务器 `sendToDisplay` 增加睡眠检查选项，任务引擎/旧报时路径传递检查参数，显示端移除通用 TTS 睡眠暂停和丢弃逻辑
  - 验证：TTS 睡眠策略 3 项、控制端协议 5 项、显示端睡眠集成 31 步通过
  - 文档：docs/design/display-sleep-mode.md、docs/spec/display-sleep-mode.md、docs/design/tts.md、docs/spec/tts.md、docs/task/2026-08-22_服务器TTS按调用方检查显示端睡眠.md

- ✅已完成 [2026-08-22][2026-08-22] 控制端聊天消息支持 Markdown 解析显示
  - 用户消息、普通 LLM、群聊、私聊和工作 AI 角色消息统一使用安全 Markdown 渲染器；输入框保持纯文本
  - 改动：`src/apps/web-mediacenter/ui/public/js/chat-markdown.js`、`src/apps/web-mediacenter/ui/public/js/chat.js`、`src/apps/web-mediacenter/ui/public/css/chat.css`、`src/apps/web-mediacenter/ui/public/upload.html`
  - 验证：Markdown 格式、原始 HTML 转义、危险链接过滤和前端加载顺序测试通过
  - 文档：docs/design/chat-system.md、docs/spec/chat-system.md、docs/task/2026-08-22_控制端聊天消息Markdown解析显示.md

- ✅已完成 [2026-08-21][2026-08-21] 修复控制端普通 LLM 流式消息不及时显示
  - 根因：普通 LLM 的 `chatChunk`/`chatResponse` 缺少 `requestId`，被控制端过滤
  - 改动：普通 `chatMessage` 将请求号传入 `handleChatMessage`，增量/成功/失败回包统一透传
  - 验证：流式请求号回归测试通过；AI 角色 service、handler、ClaudeBridge、role-store 测试通过；pipe-keeper 测试受沙箱 `mkfifo EPERM` 限制未能执行
  - 文档：docs/design/chat-system.md、docs/spec/chat-system.md、docs/task/2026-08-21_控制端LLM流式消息及时显示修复.md

## 开发工具

- ✅已完成 [2026-08-21][2026-08-21] 新增绕过 HTTPS 代理的服务器重启 npm 命令
  - 改动：Node 原生 HTTP/HTTPS 请求调用 `/api/restart`，默认地址可通过环境变量或命令行覆盖
  - 文档：docs/design/server-restart-script.md、docs/spec/server-restart-script.md、docs/task/2026-08-21_服务器重启命令脚本.md

## 媒体播放

- ✅已完成 [2026-08-24][2026-08-24] 修复显示端单个视频循环播放
  - 根因：批量播放 `playCurrentItem()` 设置 `mediaVideo.loop=false` 后，单视频/重连恢复没有恢复 `true`，导致单个视频播放完不循环。
  - 修复：`showMedia()` URL/base64 视频分支统一设置 `mediaVideo.loop=true`；批量分支保持 `false`，继续 ended 切下一项。
  - 验证：新增静态回归 `tests/display-video-loop.test.js`，播放恢复回归通过。
  - 文档：docs/design/display.md、docs/design/batch-playlist.md、docs/spec/audio-media.md、docs/spec/batch-playlist.md、docs/task/2026-08-24_修复显示端单个视频循环播放.md

- ✅已完成 [2026-08-23][2026-08-23] 修复动态画面填充无过渡直接跳变
  - 根因：动态阶段写入 transition 的同时清空并重写宽高，浏览器没有可插值的旧尺寸。
  - 修复：布局刷新后保留当前宽高，在下一帧写入目标尺寸；真实显示页回归测试验证过渡中尺寸。
  - 文档：docs/design/dynamic-fit-mode.md、docs/spec/dynamic-fit-mode.md、docs/task/2026-08-23_修复动态画面填充过渡.md

- ✅已完成 [2026-08-23][2026-08-23] 新增动态画面填充模式
  - 显示端在适应与铺满之间循环，默认过渡 3 秒、停留 2 秒；控制端可按显示端设置并持久化两个时间。
  - 改动：动态阶段控制器、显示端宽高动画、服务端状态协议、控制端/设备列表/浮动控制入口。
  - 验证：动态控制器、显示端恢复、旋转裁剪、媒体播放和显示端身份定向测试共 20 项通过。
  - 文档：docs/design/dynamic-fit-mode.md、docs/spec/dynamic-fit-mode.md、docs/task/2026-08-23_动态画面填充模式.md

- ✅已完成 [2026-08-20][2026-08-20] 音频媒体播放与睡眠批量手动切换
  - 改动：支持 WAV/OGG/MP3；贯通控制端、服务器、显示端与批量播放；控制端手动“下一个”触发临时激活，自动定时器睡眠拦截保持不变；实时同步当前文件名，控制端刷新后恢复批量文件名
  - 文档：docs/design/audio-media.md、docs/spec/audio-media.md、docs/task/2026-08-20_音频媒体播放与睡眠批量手动切换.md

- ✅已完成 [2026-08-21][2026-08-21] 媒体重连恢复播放进度
  - 改动：缓存并恢复 video/audio 单媒体进度；批量恢复当前索引、当前 video/audio 项进度及暂停状态；进度持久化增加节流与暂停/切项强制同步
  - 文档：docs/design/display.md、docs/design/audio-media.md、docs/design/batch-playlist.md、docs/spec/audio-media.md、docs/spec/batch-playlist.md、docs/task/2026-08-21_媒体重连恢复播放进度.md

- ✅已完成 [2026-08-22][2026-08-22] 显示端身份隔离与批量状态恢复
  - 服务器以稳定 `displayId` 持久化显示端设置和批量进度，旧 IP 状态首次连接时兼容迁移；Agent/测试端可用 `agent-local` 与真实显示端区分，控制端同时展示 ID 和 IP
  - 批量重连先恢复通用显示设置，再恢复列表索引、播放时间和暂停状态；控制端切换显示端时清空旧批量面板并按新显示端状态恢复
  - 控制端保存显示端选择模式、显示列表视图和最近选择的显示端 ID，显示端短暂断线重连后可恢复目标选择
  - 验证：新增回归 5 项；批量/音频/播放恢复/Agent/TTS 相关回归 40 项中 39 项通过，既有 display-native-bridge 原生触摸注入环境用例失败未涉及本次代码
  - 文档：docs/design/display.md、docs/design/batch-playlist.md、docs/spec/config.md、docs/spec/batch-playlist.md、docs/spec/display-selection.md、docs/task/2026-08-22_显示端身份与批量状态恢复.md

## AI 角色

- ✅已完成 [2026-08-23][2026-08-23] 修复 Claude 超时重建测试误判
  - 首轮保留短超时验证进程清理，重建后的第二轮恢复正常响应窗口，避免冷启动耗时误判为响应失败
  - ClaudeBridge 13 项、AI 角色模块 51 项测试通过
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-23_修复Claude超时重建测试误判.md

- ✅已完成 [2026-08-23][2026-08-23] 移除控制端大脑页签
  - 删除控制端“大脑”导航入口、日志大脑面板、查看器脚本、初始化钩子和专用样式；保留服务器端 LogBrain、日志 API 和测试
  - 不新增 Agent 日志读取规则，Agent 继续按现有后端能力读取项目日志文件
  - 文档：`docs/design/log-brain.md`、`docs/spec/log-brain.md`、`docs/design/sidebar-registry.md`、`docs/spec/sidebar.md`、`docs/task/2026-08-23_移除控制端大脑页签.md`

- ✅已完成 [2026-08-22][2026-08-22] 修复控制端 Agent 流式消息显示并按普通 LLM 语义播报 TTS
  - 根因：Agent 启动状态广播 `roleList` 时重建整个聊天面板，移除了已创建的用户消息和流式回复节点，导致文字与用户消息等到完成回包才出现
  - 改动：聊天请求进行中只更新角色在线状态；Agent 的 `chatChunk` 继续实时更新回复，并沿用完整句子串行 TTS 队列及完成时尾句冲刷
  - 验证：AI Agent 控制端测试 4 项；AI 角色、Agent 后端、TTS、聊天流式相关测试串行 65 项全部通过
  - 文档：`docs/design/ai-roles.md`、`docs/spec/ai-roles.md`、`docs/task/2026-08-22_控制端Agent流式消息显示与LLM同构TTS.md`

- ✅已完成 [2026-08-22][2026-08-22] Agent 后端独立于服务器进程，修复服务器重启后控制端 Agent 离线
  - 新增 detached `agent-backend-host` 和 Unix Socket JSON Lines IPC；服务器仅保留 `AgentBackendClient`，不再直接持有生产 Agent 的 stdio/FIFO。
  - 服务器重启时复用后端宿主中的 Claude/Codex bridge、PID 和 Codex thread；Socket/宿主失效时自动拉起并允许下一次消息懒重建。
  - 验证：IPC 4 项、真实 Codex 进程重连、AI 角色服务 14 项、Claude/Codex/role-store/WS 相关 35 项及聊天/TTS/UI 回归通过。
  - 改动：`src/apps/server/modules/ai-roles/agent-backend-host.js`、`agent-backend-client.js`、AiRolesService、server-app、WS handler 及测试。
  - 文档：`docs/design/ai-roles.md`、`docs/spec/ai-roles.md`、`docs/task/2026-08-22_Agent后端独立于服务器进程.md`

- ✅已完成 [2026-08-22][2026-08-22] 修复 Codex 响应超时导致 Agent 离线
  - 改动：默认超时调整为 10 分钟；收到流式增量时重置无活动超时计时器；正常完成保持在线
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-22_Codex响应无活动超时修复.md

- ✅已完成 [2026-08-21][2026-08-21] 修复控制端 Agent 启动状态刷新和关闭按钮错误处理
  - 改动：Agent 启动成功立即广播在线状态；stop-all 状态查询不重新创建 bridge；前端检查 HTTP 响应并显示真实错误
  - 说明：Claude/Codex 当前自动通过权限审批并以高权限运行；聊天消息现由控制端共享 Markdown 渲染器显示
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端Agent在线状态与关闭错误修复.md

- ✅已完成 [2026-08-21][2026-08-21] 控制端关闭所有 Agent 与角色在线状态显示
  - 改动：系统设置新增关闭所有 Agent；服务端停止并清空 bridge、广播 roleList；角色 tab 显示在线/离线；不删除角色文件
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端关闭所有Agent与在线状态.md

- ✅已完成 [2026-08-21][2026-08-21] 控制端 AI 角色 Claude/Codex Agent 后端选择
  - 改动：聊天设置全局选择、默认 Codex、角色实际后端持久化、Codex app-server 持久 thread、Agent/LLM 消息区分；控制端 Agent 不进入 poll.js 任务队列
  - 文档：docs/design/ai-roles.md、docs/spec/ai-roles.md、docs/task/2026-08-21_控制端AI角色Agent后端选择.md

- [ ] Claude Code 本机代理恢复后，验证工作 AI 角色真实回复链路
  - 当前非交互 stream-json 启动已修复；验证时本机模型代理返回 HTTP 502，需代理恢复后复测

- ✅已完成 [2026-08-18][2026-08-18] 退出睡眠时视频检查控制端播放/暂停设置
  - 根因：resumeSleepMedia 无条件 mediaVideo.play()，忽略控制端暂停（单媒体无本地 isPlaying 跟踪，播放列表忽略 ps.paused）
  - 实现：新增 mediaIsPlaying（showMedia/handleControl play 同步）+ shouldPlayMedia（播放列表读 ps.paused）+ resumeSleepMedia 守卫
  - 验证：集成测试 30 步全绿（+3 步，真实 mp4）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-18_睡眠恢复检查播放状态.md
- ✅已完成 [2026-08-18][2026-08-18] 下发媒体取消手动覆盖（临时激活优先级高于 override）
  - 根因：activateTemporarily 只临时压过覆盖 60 秒，激活过期回落手动覆盖，下发媒体未真正取消覆盖
  - 实现：activateTemporarily 同时 manualSleepMode=null，媒体正常显示，过期按时段判定
  - 验证：集成测试 27 步全绿（步骤 13 改断言）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-18_下发媒体取消覆盖.md
- ✅已完成 [2026-08-17][2026-08-17] 睡眠模式视频未暂停修复（播放路径缺睡眠守卫）
  - 根因：document click 监听无守卫（display:block && paused 时点击即恢复视频）+ 空格/handleControl play/播放列表切播均无 isSleepPaused 守卫
  - 实现：display.html 四处统一加 isSleepPaused() 守卫（click/空格忽略、play 命令拒绝、playCurrentItem 不切播）
  - 验证：puppeteer 实测 click/空格/play 均保持 paused=true；集成测试 27 步全绿（+3 步）
  - 文档：docs/spec/display-sleep-mode.md、docs/design/display.md、docs/task/2026-08-17_睡眠模式视频守卫.md
- ✅已完成 [2026-08-17][2026-08-17] 自动播报开关关闭后仍播报修复 + 开关持久化
  - 根因：服务端 setAutoTts 分支未转发显示端（只更新 time.announce），显示端 autoTtsEnabled 恒为 true
  - 实现：setAutoTts 补 sendToDisplay 转发 + 持久化 state.autoTts/updateDisplayState + 显示端 handleRestoreState 恢复
  - 验证：WS 实测转发日志 + config autoTts=True 持久化；集成测试 24 步全绿（+2 步）；附带修 display-sleep-mode 测试 h+1=24 clamp 时间敏感 bug
  - 文档：docs/spec/websocket.md、docs/design/display.md、docs/task/2026-08-17_自动播报开关修复.md
- ✅已完成 [2026-08-17][2026-08-17] http 媒体库支持获取文件大小 + 批量播放视频 seek
  - 实现：HttpProvider._fetchHead（HEAD 取 Content-Length/Last-Modified）+ getFile 填 size + list 并发补 size（小并发池 6）+ MediaLibraryManager.getFile 委托（修 proxy 端点 Range 恒回落 200 的静默 bug）
  - 验证：mnt 库 list 60 文件 56 个真实 size（0.36s）；库代理 Range 端到端 206 + Content-Range；播放列表 60 项全部同源代理 URL；11 个单测全绿
- ✅已完成 [2026-08-17][2026-08-17] HTTP 路径媒体无法播放修复（手动输入 http 地址 / http 媒体库被混合内容拦截）
  - 设计文档：docs/design/media-library.md（HTTP 媒体混合内容修复 + Range 流）
  - 实施计划：docs/task/2026-08-17_HTTP媒体混合内容修复.md
  - 实现：sendToDisplay 统一重写 http→/api/media-proxy（覆盖手动 URL/restore/单文件）+ 通用代理（流式+Range 透传+超时+SSRF 防护）+ HttpProvider 同源 HTTPS 库代理 URL + 库代理 Range + _fetchHtml 8s 超时（修 101 挂死）+ _parseHtml 垃圾条目过滤
  - 验证：Apache 日志 206 全量下载+分段续传（视频实际播放）；Range 透传 206；SSRF 403；垃圾条目 4→0；init 2.5s 内完成；8 个单测全绿
- ✅已完成 [2026-08-16][2026-08-16] Android 显示端 GPU Compute 桥（GLES 3.1 离屏计算）
  - 设计文档：docs/design/android-compute-bridge.md
  - 实施计划：docs/task/2026-08-16_android-gpu-compute桥.md
  - 实现：ComputeEngine.kt（离屏 EGL 3.1）+ ComputePixels.kt（像素翻转/通道）+ NativeBridge.compute() + JS NativeCompute 封装
  - 真机验证（三星 Note 8 / Android 9 / display 2）：数值翻倍 [2,4,6,8]、坏 shader 合法 JSON 错误、Float32Array 归一化、图像上下/红蓝正确
- ✅已完成 [2026-08-15][2026-08-15] Android APK 显示端（跨域控制增强）：WebView 包装 + 原生桥（真实像素截图 + 跨域输入注入），浏览器显示端保留并声明无跨域控制能力
  - 设计文档：docs/design/android-display.md
  - 实施计划：docs/task/2026-08-15_android-apk显示端.md
  - 实现：src/apps/android-display/（APK 工程）+ display.html 桥截图/输入链 + 能力声明 + 控制端提示
- ✅已完成 [2026-08-20][2026-08-20] APK 上传命令自动恢复服务器地址
  - `upload:apk` 安装后通过 Intent 注入 `https://192.168.1.39:8081`，APK 保存配置并自动连接。
  - 支持 `AASC_DISPLAY_SERVER_URL` 覆盖默认地址；覆盖冷启动和 `singleTask` 新 Intent。
  - 改动：`src/scripts/apk-deploy.js`、`src/scripts/apk-deploy-config.js`、`MainActivity.kt`、`ServerConfig.kt` 及对应测试/文档。
  - 真机验证（三星 Note 8 / Android 9，WebView 升级到 132 后）：
    - 跨域 html（example.com）原生截图稳定回传（1280x623，mode=native）
    - 无障碍真实触摸注入生效（InputDispatcher Delivering touch to WebView）
    - 能力声明 crossOriginControl:true 正常上报
    - 原生桥截图改同步返回（回调式在 WebView 不可靠）
- ✅已完成 [2026-08-16][2026-08-16] html 模式持久化 + 显示端自动刷新 + 控制端主动刷新/重载服务端 + 视频自动播放
  - html 滚动模式持久化到服务器，显示端重启后恢复
  - 显示端每 8 秒轮询 /api/display-version 自动 reload（无需重启 APK）
  - 控制端「刷新」按钮主动刷新显示端；系统设置「重载代码」按钮重启服务端
  - 视频自动播放 muted 绕过拦截（真机视觉待用户确认）
- ✅已完成 [2026-08-16][2026-08-16] render-display 覆盖层文字内嵌 + GPU/显存第二行
  - 设计文档：docs/design/render-display-inline-text.md
  - 实施计划：docs/task/2026-08-16_render-display-文字内嵌与GPU显存第二行.md
  - 实现：res/tasks/render-display/render.js（条内居中浮层文字、第二行 GPU/VRAM 占位对齐）
  - 验证：node render.smoke.js（结构校验）+ node --check
- ✅已完成 [2026-08-26][2026-08-26] render-display 旋转覆盖层位置修正
  - 实施计划：docs/task/2026-08-26_render-display旋转位置修正.md
  - 实现：res/tasks/render-display/render.js（来源重建后重新定位、90°/270°媒体名避让）
  - 验证：旋转位置回归 1/1、显示端相关回归 41/41、集成回归 9/9、render.smoke.js + node --check
- ✅已完成 [2026-08-26][2026-08-26] render-display 180°覆盖层位置修正
  - 实施计划：docs/task/2026-08-26_render-display180度位置修正.md
  - 实现：res/tasks/render-display/render.js（180°覆盖层避让媒体名并保持视口边界）
  - 验证：旋转位置回归 1/1、显示端相关回归 41/41、集成回归 9/9、render.smoke.js + node --check
- ✅已完成 [2026-08-17][2026-08-17] 重构 ai 开发流程：文件驱动多 Agent 工作组（workgroup）
  - 设计文档：workgroup/docs/design.md
  - 实现文档：workgroup/docs/spec.md
  - 实现：workgroup/tools/（wg-core.js 纯函数 / wg-fs.js 文件系统 / poll.js 主入口）
  - 多独立 Claude 进程通过文件系统组队：main 分发、子 agent 自治轮询、history 历史画像

## Android APK

- ✅已完成 [2026-08-26][2026-08-26] 完成 APK TTS 并发引擎池（Task 4）
  - 新增 `TtsEnginePool.kt`，按 TTS 大核+小核 policy 建立 `max(1, policy.totalCoreCount)` 个独立 silent synthesizer slot，每个 slot 拥有单线程 worker。
  - `TtsEngine.kt` 保持 `load/synthesize/release/ready` 公开接口，内部改为安全替换 pool；模型加载和 TTS CPU policy 变更不会释放正在合成或已排队旧请求使用的 synthesizer。
  - `NativeBridge.kt` 的同步/异步 TTS 路径进入 pool；新增 `TtsBridgeDispatcher`，以当前 policy 的 `max(1, totalCoreCount)` 固定 worker 和同等容量队列在桥提交边界拒绝溢出，sync 返回普通 error JSON、async 返回 `accepted:false`，并在 `cpuConfigure` 成功后锁内换代，旧任务排空不打断。
  - 静音约束：每个真实 TTS slot 继续使用 `SpeechSynthesizer(config, null)`，APK 生成阶段只回传 WAV，不连接默认扬声器。
  - 回归测试：`TtsEnginePoolTest` 覆盖 overflow admission bound；`TtsEngineAudioOutputTest` 覆盖静音构造及 `probeVoice()` 的 `SynthesisVoicesResult`/probe synthesizer 关闭；另含 `CpuClusterTest`、`AsrEnginePoolTest`、`AsrPcmTest`、`AsrModelFilesTest`、`TtsModelFilesTest`。
  - final fix 回归测试：`TtsBridgeDispatcherTest` 覆盖固定 worker/队列提交溢出与换代后旧任务排空；静态 Node 测试约束 NativeBridge 接入有界 dispatcher、锁内换代和 accepted:false 契约。
  - 文档：docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_APK大小核并发配置.md、.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-4-fix-report.md

- ✅已完成 [2026-08-26][2026-08-26] 完成 APK ASR 并发引擎池（Task 3）
  - 新增 `AsrEnginePool.kt`，按 ASR 大核+小核 policy 建立 `max(1, policy.totalCoreCount)` 个独立 recognizer slot，单槽 `numThreads=1`。
  - `AsrEngine.kt` 支持 pool 安全替换与旧 slot 延迟释放；模型加载和 ASR CPU policy 变更不会释放正在识别的 native recognizer。
  - `NativeBridge.kt` 的同步/异步 ASR 路径进入 pool，ASR 桥任务可并发提交，超额请求由 pool 排队；60 秒超时与回调协议保持不变。
  - Task 3 review 修复：retired 旧池继续服务已 retain 的排队旧请求，最后一个 retained 调用退出后再释放 idle slot；同步修复 ASR 构造静态测试扫描路径和过时注释。
  - 回归测试：`AsrEnginePoolTest`、`CpuClusterTest`、`AsrPcmTest`、`AsrModelFilesTest`。
  - 文档：docs/design/android-native-asr.md、docs/spec/android-native-asr.md、docs/task/2026-08-25_APK大小核并发配置.md、.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-3-report.md、.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-3-fix-report.md

- ✅已完成 [2026-08-26][2026-08-26] 完成 APK CPU topology 与 JNI affinity 原语（Task 2）
  - 新增 `CpuCluster.kt`、`CpuAffinity.kt`、JNI `cpu_affinity.cpp` 和 CMake 构建，动态读取 CPU possible/online 与 `cpuinfo_max_freq`，不硬编码 display2 CPU ID。
  - `CpuTopology.policy()` 输出 big/little CPU、mask、有效数量和 fallback 状态；Kotlin/JNI 统一只支持 CPU ID `0..62`，CPU 63 和更高 ID 会被排除并标记 fallback/clamped，避免生成无法应用的非空 mask。
  - 验证：`CpuClusterTest` 红绿 TDD 通过；`npm run build:apk` 成功编译并打包 native library。
  - 文档：docs/design/android-native-asr.md、docs/spec/android-native-asr.md、docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_APK大小核并发配置.md、.superpowers/sdd/2026-08-26-apk-cpu-cluster-concurrency/task-2-report.md

- ✅已完成 [2026-08-25][2026-08-25] 修复 APK 原生 TTS 生成阶段自动播放导致的重复播报
  - Embedded Speech SDK 默认扬声器在 `SpeakText()` 阶段播放一次，服务器收到 WAV 后又下发 `playAudio` 播放一次。
  - 已改为显式空 `AudioConfig`，保留 `ttsExecutor` 后台单线程生成；Android 单测、APK 构建、npm 安装和 display2 启动均成功，端到端生成 WAV 正常。
  - 100 字串行压测 10 次全部成功，平均 3562.5ms，最大 4620ms。
  - 改动：`.../TtsEngine.kt`、`.../TtsEngineAudioOutputTest.kt`；生成阶段只回传音频，服务器统一播放。
  - 文档：docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_APK原生TTS生成阶段静音防重复播放.md

- ✅已完成 [2026-08-25][2026-08-25] 修复 Samsung DeX 下 APK 启动非全屏
  - 根因：设备以 `freeform` 窗口启动，已有沉浸式系统栏标志只能隐藏系统栏，不能改变 DeX 窗口尺寸。
  - 说明：TTS 接入将 `minSdk` 从 24 提升到 26，但设备 Android 9/API 28 仍受支持；`targetSdk=34` 未改变。
  - 修复：Manifest 增加 `com.samsung.android.dex.launchwidth/launchheight=0`，请求 DeX 启动即全屏。
  - 回归测试：`tests/apk-deploy-config.test.js` 5/5 通过；`assembleDebug` 和 Android unit tests 通过，合并 Manifest 已确认包含全屏元数据。
  - 真机限制：安装验证因现有 APK 签名不同触发 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，未擅自卸载旧 APK，避免清除设备数据。
  - 文档：docs/design/android-display.md、docs/spec/android-display.md、docs/task/2026-08-25_APK启动全屏窗口.md

- ✅已完成 [2026-08-25][2026-08-25] 修复 APK 语音识别期间显示端 WebSocket 重连风暴
  - 根因：显示页在 WebView 原生 ASR/TTS 同步阻塞或连接切换时，旧 socket 的 close 回调可能继续安排重连；原逻辑没有限制重连定时器和当前连接数量。
  - 修复：display.html 增加重连单飞、socket 身份校验和 pagehide 清理；ASR/TTS 原生桥接口暂不改动。
  - 回归测试：tests/display-websocket-reconnect.test.js 2/2 通过；相关 ASR/显示端静态回归通过。
  - 环境限制：display-native-bridge.test.js、display-sleep-mode.test.js 的 Puppeteer 浏览器在当前环境无法启动。
  - 文档：docs/design/display.md、docs/spec/websocket.md、docs/task/2026-08-25_APK语音识别期间显示端重连保护.md

- ✅已完成 [2026-08-25][2026-08-25] 修复 APK 原生 ASR 自动下载未触发
  - 修复 display.html WebGPU 异步探测访问未初始化 capabilities 导致能力检测中断的问题。
  - 修复服务器动态开启显示端 ASR 时，模型处于 not_ready/error 状态未调用 asrEnsureModel() 的问题。
  - 回归测试：tests/android-asr-download-prompt.test.js 4/4 通过；真机 APK 自动下载、hash 校验、加载并上报 voiceRecognition=true 已验证。
  - 文档：docs/design/android-native-asr.md、docs/spec/android-native-asr.md、docs/task/2026-08-25_APK原生ASR自动下载触发修复.md

- ✅已完成 [2026-08-25][2026-08-25] APK 原生 ASR/TTS 改为异步桥接
  - `NativeBridge` 新增异步 ASR/TTS 任务入口、超时处理和主线程 JS 回调，避免 WebView bridge 线程等待原生推理。
  - `display.html` 新 APK 优先使用异步入口；旧 APK 和非 APK 保留兼容路径。TTS 生成只回传 WAV，不在生成回调中自动播放。
  - ASR/TTS 原生桥和服务端显示端等待器统一使用 60 秒超时。
  - 回归测试：tests/android-native-async-bridge.test.js；Android 构建已通过，真机异步链路仍需安装新 APK 后回归验证。
  - 文档：docs/design/android-native-asr.md、docs/spec/android-native-asr.md、docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_APK原生ASR与TTS异步桥接.md

- ⏳待处理 [2026-08-25] 修复 APK 原生 ASR 识别结果为空及声纹 native 崩溃
  - 真机 `NativeDisplay.asrRecognize()` 对有效 PCM 返回 `{}`，`/api/asr/recognize` 连续 5 次全部失败；调试声纹匹配时 `VoiceprintEngine.match` native 崩溃导致 APK 进程退出。
  - 2026-08-27 对照测试：WeSpeaker 单段和 Sherpa 两种流程均可返回文字/声纹；WeSpeaker 多段滑窗 embedding 在四个音频上均触发 OOM，即使不加载 ASR 模型仍复现。
  - 2026-08-27 独立测试 APK 已移除 WeSpeaker 测试，当前验收范围仅保留 Sherpa 单段/多段；WeSpeaker 多次 embedding 的 OOM 不再阻塞该 APK。
  - 仍需继续定位生产显示端原生桥异常/结果日志，修复后再完成速度、P95 和长稳内存压测。

- ✅已完成 [2026-08-25][2026-08-25] Android 原生语音生成（TTS）
  - 基于 Microsoft Embedded Speech SDK，离线合成 Xiaoxiao，模型从服务器按需下载。
  - 显示端能力新增 `ttsGeneration`；控制端新增“语音生成设备”选项，可选服务器/显示端，显示端离线时临时回退服务器。
  - 改动：Android 新增 `TtsEngine.kt`、`TtsModelFiles.kt`、`TtsModelManager.kt`；服务器新增模型下载与 `ttsDevice` 配置及回退；显示端 display.html 与能力展示组件接入。
  - 真机验证：SM-N9500 完成模型下载、Xiaoxiao 声线加载、`voice-generation` 能力上报、`/api/tts/generate` 显示端合成 170446B WAV。
  - 构建修正：azure-core 1.58.1 要求 D8 minSdk≥26，`build.gradle.kts` 的 `minSdk` 调整为 26。
  - 文档：docs/design/android-native-tts.md、docs/spec/android-native-tts.md、docs/task/2026-08-25_android-native-tts.md
  - 复核：SM-N9500 真机 8 次生成 8 次成功；离线回退成功；完整加载后静置 PSS 约 355--360MB、Native Heap 约 149.7MB；Android unit tests 36/36 通过（使用工作区临时目录）。

- [ ] 真机验证系统媒体播放器抢占音频焦点期间的 video/audio 暂停恢复，以及控制端手动暂停和睡眠模式拦截

## 批量播放模式

- ✅已完成 [2026-08-14][2026-08-14] 批量播放模式：媒体库文件夹级批量播放
  - 文件夹「批量播放」按钮 → 模式设置框（递归/间隔/顺序随机/排序/方向/循环/播报文件名）
  - 服务端 PlaylistManager 扫描生成列表一次性下发，显示端本地自循环播放
  - 进度回传 + 暂停/继续/上一个/下一个/停止干预，单文件播放打断批量
  - 临时模式裁剪区多文件/文件夹批量上传
  - 改动文件：
    - src/apps/web-mediacenter/modules/media/playlist-app-service.js (新增)
    - tests/playlist-app-service.test.js (新增)
    - src/apps/server/boot/server-app.js
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/js/websocket.js
    - src/apps/web-mediacenter/ui/public/js/media-library.js
    - src/apps/web-mediacenter/ui/public/js/upload.js
    - src/apps/web-mediacenter/ui/public/css/upload.css
    - docs/design/batch-playlist.md (新增)
    - docs/spec/batch-playlist.md (新增)
# 当前任务

## 控制端语音配置

 - ✅已完成 [2026-08-29][2026-08-29] 修复 192.168.1.39 显示端 ASR 能力状态误报不可用
   - 异步 ASR 检查完成后补发 `voiceStatus` 和 `capabilities.voiceRecognition`，避免初始 false 状态长期留在控制端。
   - 测试：监听状态/回传契约 19/19，显示列表、语音会话和 WebSocket 重连 7/7，显示端脚本语法检查通过；详细任务见 `docs/task/2026-08-29_显示端ASR能力状态回传修复.md`。

 - ✅已完成 [2026-08-29][2026-08-29] 回传显示端所有有效识别文字并只显示最新一条
   - 声纹未匹配的文字也广播到控制端，但不进入唤醒、对话或命令处理；每个显示端仍只保留最新识别结果。
   - 测试：监听状态、显示列表、语音会话、监听回传和 WebSocket 重连 7/7 通过；详细任务见 `docs/task/2026-08-29_显示端识别结果回传最新文本.md`。

 - ✅已完成 [2026-08-29][2026-08-29] 修复显示端监听开关无响应，删除 ASR 处理区域和语言选择，迁移全局降噪开关到声纹面板
   - 改动文件：`src/apps/web-mediacenter/ui/public/js/device-list.js`、`src/apps/web-mediacenter/ui/public/js/websocket.js`、`src/apps/server/boot/server-app.js`、`src/apps/web-mediacenter/ui/public/js/voiceprint-panel.js`、`src/apps/web-mediacenter/ui/public/upload.html`、`src/apps/web-mediacenter/ui/public/display.html`、`src/apps/web-mediacenter/ui/public/js/tts.js`。
   - 测试：相关 Node 回归 14/14，正式 Display APK 构建成功。
# Android 显示端音频

## 外部应用焦点

 - ✅已完成 [2026-08-29][2026-08-29] 修复外部视频焦点切换后内部视频画面冻结
   - `MainActivity.onWindowFocusChanged(true)` 不再切换 WebView 的 `INVISIBLE`/`VISIBLE`，避免视频画面渲染面重建而音频继续播放。
   - 保留沉浸式系统栏恢复，并使用 `postInvalidate()` 请求非破坏性重绘。
   - 测试：显示端媒体焦点契约 9/9 通过；详细任务见 `docs/task/2026-08-29_外部视频焦点切换画面冻结修复.md`。

## TTS 播放

 - ✅已完成 [2026-08-29][2026-08-29] 修复 TTS 播放时视频被暂停及 TTS 音频卡顿
   - TTS 作为网页唯一音频焦点 owner；视频保持画面和原有音轨，TTS 活跃期间不再执行媒体焦点恢复循环，结束后恢复原状态。
   - 普通 TTS、文本媒体逐句 TTS 和远程文本 TTS 共用协调状态；显示端焦点契约 7/7、相关回归 37/37、`npm run build:apk` 通过。
   - 任务文档：`docs/task/2026-08-29_显示端TTS视频焦点竞争修复.md`。
   - 二次修复：原生焦点改为 `GAIN_TRANSIENT_MAY_DUCK`，忽略 `-3` 可 duck 回调，停止正常 `waiting/stalled` 的焦点重抢；焦点契约更新为 9/9，APK 已重新安装运行。

 - ✅已完成 [2026-08-29][2026-08-29] TTS 播放期间保留视频声音
   - 移除 TTS 协调和视频恢复分支中的网页主动静音，视频继续播放原有音轨；仍使用 `GAIN_TRANSIENT_MAY_DUCK`，允许系统自动 duck。
   - TTS 开始和结束均不写回视频 `muted`/`volume`；普通、远程和逐句 TTS 播放前统一设置自身音量为 100%。
   - 回归：媒体焦点及相关显示端、文本媒体、语音、睡眠测试 40/40；`npm run build:apk` 成功；APK 覆盖安装并启动 display 2，PID=17375。
   - 文档：`docs/design/android-display.md`、`docs/design/android-native-tts.md`、`docs/spec/android-display.md`、`docs/spec/android-native-tts.md`、`docs/task/2026-08-29_显示端TTS视频焦点竞争修复.md`。

 - ✅已完成 [2026-08-29][2026-08-29] 显示端视频、音频和 TTS 统一使用一个网页媒体焦点
   - 删除独立 TTS 焦点接口；所有网页媒体统一调用 `requestAudioFocus()`/`abandonAudioFocus()`，只在没有其他网页播放意图时释放。
   - 回归：统一焦点契约 11/11，相关显示端、文本媒体、语音、睡眠测试 41/41；`npm run build:apk` 成功；APK 覆盖安装并启动 display 2，PID=20732。

 - ✅已完成 [2026-08-29][2026-08-29] 还原显示端未处理 Android 原生音频焦点
   - 删除 APK 原生 `AudioFocusController`、`NativeBridge` 音频焦点桥接，以及网页 TTS/媒体对原生焦点的申请、释放和恢复回调。
   - 保留 WebView 网页 TTS、视频播放、普通音频和音量设置；焦点契约 8/8、相关回归 38/38、内嵌脚本语法检查和 `git diff --check` 通过。
   - `npm run build:apk` 成功；`adb install -r` 覆盖安装成功，display 2 启动成功，真机进程 PID=22246。
   - 任务文档：`docs/task/2026-08-29_显示端TTS视频焦点竞争修复.md`。

 - ✅已完成 [2026-08-29][2026-08-29] 恢复 Android Kotlin 基线代码
   - 恢复 `NativeBridge.kt` 和 `AudioFocusController.kt` 到 Git 基线；APK 启动时申请一个共享原生焦点，网页端不重复申请或释放。
   - 网页媒体和 TTS 通过事件/watchdog 自动恢复，连续失败有限重试，避免形成无限播放循环。
   - 其他 Android Kotlin 文件没有未提交改动，未做无关恢复。
   - 焦点契约 8/8，相关回归退出码 0；`npm run build:apk` 成功，APK 覆盖安装并启动 display 2，真机 PID=24605。
   - `dumpsys audio` 确认启动原生焦点申请成功；WebView 网页媒体仍可能建立独立的 Chromium 内部焦点请求。
   - 任务文档：`docs/task/2026-08-29_显示端TTS视频焦点竞争修复.md`。

 - ✅已完成 [2026-08-29][2026-08-29] 修复网页 TTS 被其他 APK 抢占音频焦点后卡住
   - 普通 TTS 与文本媒体逐句 TTS 保留当前网页音频和句子位置，主动申请原生焦点并在焦点恢复后继续播放。
   - 改动：`src/apps/web-mediacenter/ui/public/display.html`、`src/apps/web-mediacenter/ui/public/js/text-media-player.js`、`tests/display-media-focus.test.js`。
   - 构建：`npm run build:apk` 成功；真机旧签名私钥不在工作区，未卸载旧 APK。
