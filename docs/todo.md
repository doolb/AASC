- 修复90度和270度时，上下拖动裁剪框，显示端是左右方向的问题
 - 控制端移动裁剪框是正确的
 - 0度和180度正确的
- 拆分代码，分为核心代码，和业务代码
 - 核心代码负责处理显示端和控制端的通信
 - 业务代码负责处理业务逻辑，如裁剪、播放视频等

## ✅ 已完成 CSS 文件拆分
- display.html CSS 拆分到 `public/css/display.css`
  - 包含媒体容器、时间显示、文件名显示、连接状态样式
  - 包含提醒弹窗样式 `.reminder-popup`
  - 包含响应式布局 `@media (max-width: 768px)`

# 项目结构
## 配置文件目录
- ✅ 已完成~~配置文件统一迁移到 `config/` 目录~~
  - `config/config.json` - 主配置文件（服务器端口、TTS配置、显示端状态、聊天配置）
  - `config/chat-history.json` - 聊天历史记录
  - `config/media-libraries.json` - 媒体库配置
  - core/config.js:4 路径更新为 `path.join(__dirname, '../config/config.json')`
  - core/chat.js:7 路径更新为 `path.join(__dirname, '../config/chat-history.json')`
 
- ✅ 已完成~~显示端支持通过~~
tts.js
生成语音功能，用于显示端播放语音
播放媒体时，显示端会自动播放语音，语音内容是当前媒体的名称

- ✅ 已完成~~合并播放和暂停按钮~~
  - upload.html:59-63 将两个按钮合并为一个切换按钮 `<button id="playPauseBtn" onclick="togglePlayPause()">`
  - controls.js `togglePlayPause()` 切换播放/暂停状态，自动更新按钮文字和背景颜色
  - controls.js `setPlayingState(playing)` 供外部设置播放状态
  - upload.css `.playing` 绿色渐变, `.paused` 橙红色渐变
  - server.js:43 `createDisplayState()` 添加 `isPlaying` 状态字段
  - server.js:415-417 处理 `play` action 时保存播放状态
  - websocket.js:57-59 收到 `displayState` 时更新播放按钮状态

- ✅ 已完成~~画面填充和旋转按钮选中状态背景颜色切换~~
  - upload.html 画面填充按钮添加 `data-fit` 属性，旋转按钮添加 `data-rotation` 属性
  - controls.js `sendFitMode()` 点击时更新按钮选中状态
  - controls.js `setFitMode()` 供外部设置填充模式状态
  - crop.js `applyRotation()` 点击时更新按钮选中状态
  - crop.js `setRotation()` 供外部设置旋转状态
  - websocket.js:50-52 收到 `displayState` 时更新填充模式按钮状态
  - upload.css `.active` 蓝色渐变背景
- ✅ 已完成~~新加一个本地配置表，~~
 - 保存端口配置，保存语音服务地址，语音服务端口
 - 保存媒体库配置，保存媒体库文件夹路径，多个媒体库
- 现在控制端看不到预览图，点播放也没有显示到显示端,控制端媒体列表看不到预览图
- 控制端需要看到媒体列表，图片，gif，视频的预览图，有一部分显示端的画面没有正常显示

- ✅ 已完成~~控制端媒体列表标注当前播放的媒体~~
  - media-list.js:2 添加 `currentMediaUrl` 属性存储当前播放媒体
  - media-list.js:46-48 渲染时判断是否正在播放，添加 `.playing` 类和徽章
  - media-list.js:83-126 `setCurrentMedia(url)` 方法更新播放状态并滚动到当前播放项
  - websocket.js:69-71 收到 `displayState` 时同步更新媒体列表播放状态
  - upload.css:232-258 `.media-item.playing` 绿色边框，`.playing-badge` 徽章样式


- ✅ 已完成~~新增保存显示端当前播放列表，画面填充设置，服务端重启后，可以恢复到上次播放的状态，~~
 - 需要区分不同的显示端，用ip地址区分
 - 音量状态也要保留，控制端的语音滑动框也需要同步恢复

# 控制端
- ✅ 已完成~~服务端重启按钮，点击后，会发送重启请求到服务端，服务端会重启，显示端会重新连接~~
  - server.js:303-336 `POST /api/restart` 接口
  - server.js:316-325 使用 `spawn` 启动新进程后退出，实现自重启
  - upload.html:118 添加重启服务器按钮
  - controls.js:83-117 `restartServer()` 发送重启请求，5秒后自动刷新页面

## 页面交互
- ✅ 已完成~~界面左侧有一个页签，可以快速跳转不同的功能模块~~
 - 功能模块分组：
   - 媒体管理：上传文件、URL上传、服务器资源
   - 显示控制：显示端选择、显示控制、裁剪
   - 提醒设置：提醒设置
   - AI助手：AI聊天助手
 - 布局：左侧固定宽度侧边栏 + 右侧自适应内容区
 - 交互：点击导航项切换显示对应面板
 - 状态持久化：使用 localStorage 记住用户最后选中的面板
 - 实现代码：
   - public/upload.html 添加侧边栏 `<nav class="sidebar">` 和面板 `<section class="panel">`
   - public/css/upload.css 添加 `.sidebar`, `.nav-item`, `.content`, `.panel` 样式
   - public/js/main.js 添加 `Sidebar` 对象，包含 `init()`, `switchPanel()`, `saveLastPanel()`, `loadLastPanel()` 方法
 - 实现：详见 docs/spec/sidebar.md

## 控制端查看显示端信息
- ✅ 已完成~~显示端navigator.userAgent，用于判断显示端的浏览器类型，然后可以在控制端查看内容,参考showinfo.html~~ 
- ✅ 已完成~~控制端显示列表新增详情按钮，点击可查看显示端的功能支持（Feature Support）~~ 
  - 上传 display.html:sendFeatureSupport

## 显示端切换功能
- 新增显示端全选和自适应功能，
 - 全选时，下发到所有显示端，
 - 自适应时，根据显示端画面比例（包含旋转角度）和媒体比例来下发媒体，
 - 横向的媒体，下发到横向显示端
 - 纵向的媒体，下发到纵向显示端

# 媒体库功能
- 新增媒体库功能，用户可以在控制端查看和管理已上传的媒体
 - 支持视频和图片上传
 - 支持删除已上传的媒体
 - 支持预览已上传的媒体
 - 支持配置媒体库文件夹路径，多个媒体库
 - 支持文件夹中的媒体管理
 - 支持上传文件夹
 - 支持删除文件夹
 - 支持http协议的媒体库
 - 使用smb2库 支持smb协议的媒体库 ，参考smb2.js


- 服务器重启后，状态恢复功能，需要从本地配置表中读取上次播放的状态，
 - 播放列表
 - 画面填充设置
 - 音量状态
 - 语音滑动框位置
 - bug：重启后，显示端先连接，再断开，会触发两次tts生成，实际语音只播了一次

- ✅ 已完成~~upload.html 拆分代码，每个文件负责一个功能模块~~
 - upload.html 负责上传文件
 - js
  - websocket.js 负责处理与服务端的websocket通信
  - media-list.js 负责处理媒体上传的业务逻辑 显示媒体列表
  - display-list.js 负责处理显示端的业务逻辑
  - crop.js 负责处理裁剪功能
  - tts.js 负责处理语音播报功能
  - controls.js 负责处理进度/音量控制
  - toast.js 负责处理提示消息
  - upload.js 负责处理文件上传
  - main.js 主入口和初始化
 - css
  - upload.css 负责上传文件的样式

## 辅助功能
- ✅ 已完成~~整点报时功能，每整点半个小时报一次，在服务端检查当前时间是否是整点，是则报时，生成语音播报，下发到显示端~~
  - core/timeAnnounce.js 整点报时模块
    - `init(config)` 初始化配置
    - `start(displayClients, sendToDisplay)` 启动定时器
    - `stop()` 停止定时器
    - `checkAndAnnounce()` 检查并执行报时
    - `generateTimeText()` 生成报时文本（如"现在时间是下午3点整"）
    - `shouldAnnounce()` 判断是否应该报时（支持15/30/60分钟间隔）
    - `getConfig()` / `setConfig()` 获取/设置配置（支持 repeatCount、repeatDelay）
  - server.js 集成
    - 引入 timeAnnounce 模块
    - 服务器启动时调用 `timeAnnounce.start()`
    - `/api/timeAnnounce/config` GET/POST 获取/设置整点报时配置
    - 处理 `testTimeAnnounce` action，强制触发报时
  - 控制端配置界面
    - upload.html 添加整点报时设置面板
    - 支持配置：启用/禁用、播报间隔（15/30/60分钟）、重复次数、重复间隔
    - tts.js `loadTimeAnnounceConfig()` / `saveTimeAnnounceConfig()` 加载/保存配置
  - 播报逻辑
    - 整点报时：发送到所有显示端
    - 支持重复播报：可配置重复次数和间隔时间
    - 测试整点报时：发送到所有显示端
    - 自定义播报：需要选择显示端，只发送到选中的显示端
    - 停止播报：停止所有显示端的播报
  - 优化：服务端生成 TTS 后直接发送音频 URL，显示端直接播放，避免重复生成

## ✅ 已完成 提醒功能
 - 新增提醒功能，用户可以在控制端设置提醒时间，服务端会在指定时间提醒用户
 - 提醒内容：用户输入的提醒内容
 - 提醒时间：用户设置的提醒时间
 - 提醒方式：用户选择的提醒方式，如语音播报，弹窗提示等，在所有显示端都生效
 - 服务端记录提醒时间，提醒方式，提醒内容
 - 服务端在指定时间，根据提醒方式，提醒用户
 - 语音播报：生成语音播报，下发到显示端
 - 弹窗提示：在显示端弹窗提示用户，提醒内容
 - 提醒内容：提醒时间+提醒内容
 - 每次提醒重复次数：每次触发提醒时，重复播报/弹窗的次数（1-10次），默认1次
 - 重复提醒：用户可以选择重复提醒，重复提醒时间间隔
 - 重复提醒时间间隔：用户设置的重复提醒时间间隔，单位为分钟
 - 重复提醒次数：用户设置的重复提醒次数，0表示无限重复，默认10次
 - 取消提醒：用户可以在控制端取消提醒，服务端会停止提醒用户
 - 临时提醒和每天提醒：用户可以选择临时提醒，提醒时间只在当前时间生效，每天提醒，提醒时间每天生效
 - 编辑提醒：用户可以编辑已创建的提醒，修改提醒内容、时间、类型、方式、重复次数等
 - 单独测试提醒：可以选中某条提醒进行测试，支持发送到选中显示端或所有显示端
 - 媒体管理界面显示端选择：在媒体管理界面也可以选择显示端

### 实现代码
- core/reminder.js 提醒核心模块
  - `init()` 初始化，加载提醒数据
  - `addReminder(data)` 添加提醒（支持 repeatCount 字段）
  - `updateReminder(id, data)` 更新提醒
  - `deleteReminder(id)` 删除提醒
  - `toggleReminder(id, enabled)` 启用/禁用提醒
  - `start(displayClients, sendToDisplay)` 启动定时检查
  - `checkReminders()` 检查并触发提醒
  - `triggerReminder(reminder)` 执行提醒动作（支持重复播报）
  - `testReminder(reminderData, targetDisplayId, sendFunc)` 测试提醒（支持指定显示端）
- server.js 提醒 API
  - `/api/reminders` GET 获取所有提醒
  - `/api/reminders` POST 创建新提醒
  - `/api/reminders/:id` PUT 更新提醒
  - `/api/reminders/:id` DELETE 删除提醒
  - `/api/reminders/:id/toggle` POST 启用/禁用提醒
  - `/api/reminders/test` POST 测试提醒
  - `/api/reminders/:id/test` POST 测试指定提醒（支持 displayId 参数）
- public/js/reminder.js 控制端提醒管理
  - `loadReminders()` 加载提醒列表
  - `renderReminderList()` 渲染提醒列表
  - `addReminder()` 添加提醒
  - `editReminder(id)` 打开编辑弹窗
  - `saveEditReminder()` 保存编辑
  - `testSingleReminder(id)` 测试单条提醒
  - `closeEditReminderModal()` 关闭编辑弹窗
  - `toggleReminder(id, enabled)` 切换提醒状态
  - `deleteReminder(id)` 删除提醒
  - `testReminder()` 测试提醒
- public/upload.html 编辑弹窗界面
  - 编辑提醒弹窗 `#editReminderModal`
  - 支持编辑：内容、时间、类型、方式、每次重复次数、重复提醒设置
- public/display.html 显示端弹窗
  - `handleReminder(data)` 处理提醒消息
  - `showReminderPopup(time, content)` 显示弹窗提示
- config/reminders.json 提醒数据存储
- docs/spec/reminder.md 提醒功能规格文档

# 语音播报功能
- 优先级
  - 1. 自定义播报
  - 2. 提醒播报
  - 3. 整点报时
  - 4. 测试整点报时
  - 5. 聊天播报
  - 6. 文件名播放

## ✅ 已完成 聊天功能
- 用户在控制端输入聊天内容，服务端通过api http://192.168.1.12:8080/v1/chat/completions 调用openai api，获取回复内容
- 服务端将回复内容下发到显示端，通过语音播报
- 服务器将回复内容，发送到控制端，用户可以在控制端查看回复内容
- 聊天记录：用户可以在控制端查看聊天记录，包括用户输入的聊天内容，和回复内容
- 聊天模板，用户可以在控制端设置聊天模板，如"你好"，"你好，我是用户"等，服务端会在新聊天时，先发送模板，再发送用户输入的聊天内容
- 生成语音时，使用流式生成，不需要等待回复内容完整，即可开始播放，
 - 当以感叹号，句号，分号，引号，~，…结尾时，就可以生成语音，不需要等待回复内容完整。
 - 流式语音要等上一个说完在说下一个，不能同时说多个句子

### 实现代码
- core/chat.js 聊天模块
  - `init(config)` 初始化配置
  - `chat(message, options)` 调用 OpenAI API 获取回复（非流式）
  - `chatStream(message, options, callbacks)` 流式调用 OpenAI API
  - `isSentenceEnd(text)` 检测句子是否结束
    - 英文：`.` `!` `?` `~` `;` `"` `'`
    - 中文：`。` `！` `？` `；` `"` `"` `'` `'` `…`
  - `getHistory()` 获取聊天记录
  - `clearHistory()` 清空聊天记录
  - `getTemplates()` / `setTemplates()` / `addTemplate()` / `removeTemplate()` 聊天模板管理
- server.js 聊天 API 和 WebSocket 处理
  - `/api/chat/config` GET/POST 获取/设置聊天配置
  - `/api/chat/history` GET 获取聊天记录
  - `/api/chat/clear` POST 清空聊天记录
  - `/api/chat/templates` GET/POST 获取/设置聊天模板
  - WebSocket `chat` 消息处理：使用 `chatStream` 流式调用
    - `onChunk` 回调：实时发送 `chatChunk` 消息到控制端
    - `onSentence` 回调：检测到句子结束时生成 TTS 并发送到显示端
    - `onComplete` 回调：发送 `chatResponse` 消息到控制端
- public/js/chat.js 控制端聊天模块
  - `init()` 初始化聊天界面
  - `sendMessage()` 发送聊天消息
  - `showStreamingMessage()` 显示流式消息容器
  - `handleChunk(data)` 处理流式消息块，实时更新显示
  - `handleResponse(data)` 处理聊天完成响应
  - `showTemplates()` / `addTemplate()` / `deleteTemplate()` 模板管理
  - `showConfig()` / `hideConfig()` / `saveConfig()` 配置管理（systemPrompt）
  - `loadConfig()` 加载聊天配置
- public/css/chat.css 聊天界面样式
  - `.chat-cursor` 光标闪烁动画
  - `.chat-config-item` 配置项样式
- public/upload.html 添加聊天 UI 区域、模板弹窗和配置弹窗

### Bug 修复
- ✅ 已完成~~修复提醒编辑弹窗无法显示问题~~
  - 问题原因：`.chat-modal-overlay.active` CSS 样式缺失
  - 修复文件：public/css/chat.css 添加 `.chat-modal-overlay.active { display: flex; }`
- ✅ 已完成~~修复聊天历史丢失问题：服务器重启后聊天记录丢失~~
  - core/chat.js 添加聊天历史持久化功能
    - `loadHistory()` 启动时从 `chat-history.json` 加载历史记录
    - `saveHistory()` 每次对话后保存历史记录到文件
    - `trimHistory()` 限制历史记录最大数量为 100 条
  - `init()` 中调用 `loadHistory()` 自动加载
  - `chat()` 和 `chatStream()` 对话完成后调用 `trimHistory()` + `saveHistory()`
  - `clearHistory()` 清空时也保存到文件
- 修复聊天 TTS 重复生成问题：服务端已生成 TTS 后发送 `action: 'playAudio'` 直接播放，避免显示端再次生成
- 修复流式语音播放重叠问题：显示端实现 TTS 队列机制
  - `ttsQueue` 存储待播放的语音项
  - `isPlayingTts` 标记当前是否正在播放
  - `queueTts(item)` 将语音项加入队列
  - `playNextTts()` 播放下一条语音，等上一句说完再说下一句
  - 监听 `ended` 和 `error` 事件自动播放下一条

