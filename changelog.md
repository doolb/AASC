# Web MediaCenter - 变更日志

## [Unreleased]

### 新增
- 聊天系统重构
  - ✅ 群聊/私聊模式支持
  - ✅ 系统指令功能（系统帮助、私聊、退出私聊）
  - ✅ 控制端语音播放（TTS 服务生成）
  - ✅ 统一的聊天记录格式和存储
  - ✅ 所有聊天消息进行语音播报
  - ✅ 根据当前选择播报到对应设备（显示端/控制端）
  - ✅ 自定义指令配置和执行
  - ✅ 重要记录功能：`系统记录{内容}`
  - ✅ 搜索功能整合到聊天系统
  - ✅ 语音播报在显示端播报时同时显示文本

### 已实现功能（现有代码）
- 提醒功能：`提醒{时间} {内容}`、重复提醒
- 报时功能：`报时`、`现在几点`、`开启/关闭报时`
- 搜索功能：`搜索{关键词}`
- 取消操作：`拒绝`、`取消`
- 指定助手对话：`{助手名字}{消息}`

### 改动文件
- core/chat.js: 新增会话状态管理、自定义指令、重要记录功能
- core/voiceCommand.js: 新增 handleSystemCommand、executeCommands 函数
- public/js/chat.js: 重写前端聊天模块，支持群聊/私聊模式、控制端播放
- public/js/websocket.js: 新增消息类型处理
- public/css/chat.css: 新增模式指示器、控制端播放选项样式
- server.js: 新增聊天消息处理、会话管理、指令执行等 API

### 修复
- 待修复的问题

### 2026-03-29 修复群聊助手名字显示问题

**已修复问题：**
- 群聊中发送以 AI 助手名字开头的消息时，自动匹配对应助手模板回复
- 发送给 AI 的消息去掉助手名字前缀，但显示和保存的消息保留完整内容
- 流式消息显示时助手名字正确显示（匹配到的助手名或默认助手名）

**改动文件：**
- public/js/chat.js: sendMessage 区分 displayMessage 和 sendMessage，分别用于显示和发送
- public/js/chat.js: showStreamingMessage 函数新增 assistantName 参数，显示正确的助手名字
- server.js: chatMessage 处理时使用 displayContent 保存用户消息
- docs/spec/chat-system.md: 更新 sendMessage 伪代码描述

### 2026-03-29 控制端语音播放改用 TTS 服务

**已完成功能：**
- 控制端播放语音改用 TTS 服务生成音频文件
- 移除浏览器 Web Speech API (speechSynthesis) 的使用
- 统一使用服务端 TTS 生成，确保语音一致性

**改动文件：**
- server.js: playOnControl 时调用 tts.generateTTS 生成音频，返回 audioUrl
- public/js/chat.js: playOnControlDevice 改为使用 Audio 对象播放音频文件
- docs/spec/websocket.md: 更新消息格式和处理流程

### 2026-03-29 修复控制端音频播放被打断问题

**已修复问题：**
- 控制端播放多句语音时，旧的句子没播完就被打断了
- 原因：每个句子生成后立即播放，没有等待上一个音频播完

**改动文件：**
- public/js/chat.js: 实现音频播放队列，等待上一个音频播完再播放下一个

### 2026-03-29 修复聊天模板持久化保存问题

**已修复问题：**
- 聊天模板没有保存到文件，重启后丢失
- 模板 id 改为使用名字，名字不能重复
- 私聊 AI 时用模板名字匹配系统提示词
- 私聊验证改用模板列表，而非旧的 assistantConfig
- 私聊消息显示对应 AI 助手名字而非"助手"
- 群聊消息错误地被保存为私聊消息（群聊消息的 target 应为 null）
- 群聊点击语音播放按钮播放的是私聊内容（索引错误）
- 系统帮助指令改用弹窗显示，而非 toast 提示

**新增功能：**
- 只发"私聊"时自动进入第一个模板对应的助手
- 群聊时消息以助手名字开头，自动使用该助手模板回复
- 私聊消息隔离：私聊模式只显示当前助手的私聊消息，群聊不显示私聊消息
- 默认模板：首次启动自动创建"小爱"模板并保存到文件
- 系统消息改为 toast 提示弹出，不再显示在聊天记录中
- 左侧页签快速切换聊天模式（群聊/各助手私聊），切换时自动刷新消息列表
- 群聊模式未指定助手时自动使用第一个模板的助手
- 移除底部模板下拉框，改用左侧页签切换
- 清空消息只清空当前页签对应的消息（群聊清群聊，私聊清对应助手）

**改动文件：**
- core/chat.js: 添加 TEMPLATES_FILE 常量和 loadTemplates/saveTemplates 函数
- core/chat.js: addTemplate 使用名字作为 id，重复名字更新内容
- core/chat.js: 新增 getTemplateByName 函数
- core/chat.js: 添加 DEFAULT_TEMPLATES 常量，首次启动自动创建默认模板
- core/chat.js: clearHistory 支持按模式清空消息
- server.js: 私聊时用 chat.getTemplateByName 匹配模板
- server.js: 群聊时使用 templateTarget 指定模板，消息 target 为 null
- server.js: /api/chat/clear 接收 mode 和 target 参数
- public/js/chat.js: deleteTemplate 改用名字参数
- public/js/chat.js: 私聊验证改用 templates 列表
- public/js/chat.js: sendMessage 检测助手名字开头的消息
- public/js/chat.js: sendMessage 群聊时发送 templateTarget 而非 target
- public/js/chat.js: renderHistory 使用 originalIndex 保留原始索引用于播放
- public/js/chat.js: renderHistory 私聊消息显示 target 作为名字
- public/js/chat.js: addSystemMessage 改为 toast 提示
- public/js/chat.js: handleSystemCommand 系统帮助改用 alert 弹窗
- public/js/chat.js: render 添加左侧页签切换，移除模板下拉框
- public/js/chat.js: setMode 切换时调用 render 刷新消息
- public/js/chat.js: clearHistory 发送 mode 和 target 参数
- public/css/chat.css: 添加页签样式

### 2026-03-29 优化聊天历史记录发送逻辑

**已优化功能：**
- 非私聊模式下不再发送历史记录给 AI 助手
- 私聊模式下保留历史记录以维持对话上下文

**改动文件：**
- core/chat.js: buildMessages 添加 includeHistory 参数
- server.js: 私聊模式传入 includeHistory: true

### 2026-03-29 修复用户消息显示名称问题

**已修复问题：**
- 控制端发送的消息重连后显示为"控制端"而非"用户"
- 原因：renderHistory 没有正确处理 role='control' 的情况

**改动文件：**
- public/js/chat.js: renderHistory 中将 role='control' 映射为用户消息显示

### 2026-03-29 修复聊天记录保存问题

**已修复问题：**
- 聊天名字垂直居中显示
- 聊天记录没有正确保存用户消息
- 原因：chatStream 函数内部使用旧格式保存消息，与 server.js 中新格式保存冲突

**改动文件：**
- public/css/chat.css: 添加 align-self: center 使名字垂直居中
- core/chat.js: 移除 chatStream 内部的消息保存逻辑，由 server.js 统一处理

### 2026-03-29 句子分割支持全角波浪号

**已完成功能：**
- 合成语言时，全角波浪号"～"也作为句子结束符

**改动文件：**
- core/chat.js: isSentenceEnd 函数添加全角波浪号 '～' (U+FF5E)
- docs/spec/websocket.md: 更新句子结束符列表说明

### 2026-03-29 控制端新增搜索页签

**新增功能：**
- 侧边栏新增搜索页签入口
- 显示搜索历史记录列表
- 支持手动输入关键词搜索
- 搜索记录可点击播放结果（TTS 播报）
- 支持删除单条搜索记录
- 支持清空全部搜索历史

**改动文件：**
- public/upload.html: 添加搜索页签 HTML 结构和导航按钮
- public/js/search.js: 新增搜索模块，处理历史显示、搜索、播放、删除操作
- public/js/websocket.js: 添加 searchHistory 消息分发到 Search 模块
- public/js/main.js: 初始化时调用 Search.init()
- public/css/upload.css: 添加搜索页签样式
- docs/spec/search.md: 新增搜索功能规格文档
- docs/spec/sidebar.md: 更新功能模块列表
- docs/spec.md: 更新模块列表
- docs/design/control.md: 更新功能模块描述

**交互流程：**
1. 进入搜索页签自动加载搜索历史
2. 输入关键词点击搜索，发送到服务端执行语音搜索
3. 点击播放按钮，TTS 播放搜索结果摘要
4. 点击删除按钮，删除单条记录
5. 点击清空按钮，清空所有历史

**Bug 修复：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能无需显示端连接即可执行
  - 改动文件：server.js, core/voiceCommand.js, public/js/search.js
  - 问题：服务端处理控制端消息时，如果没有选择显示端会直接 return，导致搜索请求无法处理
  - 修复：将 voiceCommand 相关消息处理移到显示端检查之前，搜索时允许 displayId 为空

**功能优化：**
- ✅已完成 [2026-03-29][2026-03-29] 搜索功能改用 axios + cheerio 方案
  - 改动文件：core/voiceCommand.js, docs/spec/voiceCommand.md
  - 改进：使用 axios + cheerio 替代 puppeteer，更轻量、更稳定
  - 特性：
    - 支持 AI 回答 (#b_pole 区域)
    - 支持普通搜索结果 (li)
    - 无需启动浏览器，响应更快
    - AI 回答内容限制 500 字符

### 2026-03-29 实现语音命令处理功能

**新增功能：**
- 显示端语音状态显示：识别到语音时更新状态为"语音识别中"，显示语音识别文字
- 提醒功能：支持"X分钟后"、"每天"、"每周"、"每月"、"每年"等时间表达式
- 报时功能：支持"报时"、"现在几点"、"开启/关闭报时"语音命令
- 搜索功能：支持"搜索XXX"语音命令，搜索结果语音播报并显示
- AI助手响应：支持自定义助手名字（默认"小爱"），触发对应助手响应

**改动文件：**
- core/voiceCommand.js: 新增语音命令处理模块
- server.js: 集成语音命令模块，添加 WebSocket 消息处理
- public/display.html: 添加语音文字显示、命令响应弹窗
- public/css/display.css: 添加语音状态和弹窗样式
- public/js/chat.js: 更新语音命令处理逻辑
- public/js/websocket.js: 添加搜索历史和助手配置消息处理
- docs/spec/voiceCommand.md: 新增语音命令实现文档
- docs/spec.md: 更新模块列表

**语音命令触发流程：**
- "提醒" -> 解析时间和重复规则 -> 语音确认 -> 添加提醒
- "报时/现在几点" -> 立刻报时
- "开启/关闭报时" -> 切换报时功能状态
- "搜索XXX" -> 执行搜索 -> 语音播报结果
- "小爱XXX" -> 触发对应助手响应

### 2026-03-29 优化 SMB 媒体库配置界面

**改进内容：**
- 将 SMB 共享路径拆分为"服务器地址"和"共享路径"两个独立字段
- 服务器地址：输入 SMB 服务器 IP 或域名（如 `192.168.1.100`）
- 共享路径：输入共享名称，不需要包含服务器地址（如 `share` 或 `share/subfolder`）

**改动文件：**
- public/js/media-library.js: 添加服务器地址输入框，修改表单验证逻辑
- core/media-library.js: SmbProvider 添加 `_buildSharePath` 方法，支持 server 和 share 参数组合
- server.js: POST 路由添加 server 字段解构
- docs/spec/media-library.md: 更新配置结构说明

### 2026-03-29 改进 SMB 连接错误提示

**改进内容：**
- 添加 SMB 共享路径格式验证，提供更清晰的错误提示
- 错误 `name invalid` 通常是路径格式不正确导致

**改动文件：**
- core/media-library.js: `connect` 方法添加路径格式验证

**SMB 共享路径格式：**
- Windows 风格：`\\服务器IP\共享名`（前端输入时需转义为 `\\\\服务器IP\\共享名`）
- Unix 风格：`//服务器IP/共享名`

### 2026-03-29 修复 Node.js 17+ SMB 连接加密算法不支持错误

**已修复问题：**
- Node.js 17+ 使用 OpenSSL 3.0，默认禁用了 SMB 认证需要的旧加密算法（DES/MD4）
- 错误：`Error: error:0308010C:digital envelope routines::unsupported`

**改动文件：**
- package.json: 添加 `start:legacy` 脚本，使用 `--openssl-legacy-provider` 参数启动

**使用方式：**
- `npm start` 默认启用 SMB 支持

### 2026-03-29 修复 HTTP 媒体库配置保存丢失 URL 字段

**已修复问题：**
- 控制端添加 HTTP 类型媒体库后，重启服务端报错：`Cannot read properties of undefined (reading 'replace')`
- 原因：`saveConfig` 方法保存配置时只保存了 `path` 字段，没有保存 HTTP/SMB 类型需要的 `url`、`username`、`password` 等字段

**改动文件：**
- core/media-library.js: 修复 `saveConfig` 方法，根据媒体库类型保存对应字段

---

## 历史记录

### 2026-03-29 显示端语音识别状态显示

**已完成功能：**
- 控制端显示端列表显示语音识别状态图标
- 状态图标：🎤 识别中（闪烁动画）、🎤 就绪（半透明）、🎤 不支持（灰色）

**改动文件：**
- public/display.html: 添加 sendVoiceStatus 函数上报语音状态
- server.js: 添加 voiceStatus 消息处理和状态存储
- public/js/display-list.js: 渲染语音状态图标
- public/css/upload.css: 添加语音状态样式和动画

### 2026-03-29 修复媒体库符号链接访问错误

**已修复问题：**
- 本地媒体库遇到损坏的符号链接时抛出 ENOENT 错误

**改动文件：**
- core/media-library.js: 使用 lstatSync 代替 statSync，跳过损坏的符号链接

### 2026-03-29 显示端语音识别转发到控制端

**已完成功能：**
- 显示端启动时自动启动语音识别
- 语音识别结果通过 WebSocket 转发到控制端
- 控制端 Chat 模块接收显示端语音输入
- 支持在显示端说"聊天xxx"触发控制端对话

**改动文件：**
- public/display.html: 添加语音识别初始化和结果发送
- server.js: 添加 voiceInput 消息转发
- public/js/websocket.js: 添加 voiceInput 消息处理
- public/js/chat.js: 添加 handleDisplayVoiceInput 方法
- docs/spec/websocket.md: 更新消息类型文档
- docs/design/display.md: 更新设计文档

### 2026-03-29 语音输入功能

**已完成功能：**
- 控制端添加语音输入按钮
- 支持语音识别（Web Speech API）
- 说"聊天xxx"触发语音对话，自动发送消息给 AI 助手
- AI 回复后自动播放到显示端

**改动文件：**
- public/js/chat.js: 添加语音识别功能和语音命令处理
- public/css/chat.css: 添加语音输入按钮样式
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 优化媒体库 URL 生成

**已优化功能：**
- 默认 uploads 目录使用静态文件服务 `/uploads/`
- 其他本地目录使用动态静态路由 `/media/{id}/`
- HTTP 媒体库直接使用原始 HTTP 路径，不走代理

**改动文件：**
- core/media-library.js: LocalProvider 添加动态路由支持，HttpProvider 直接返回原始 URL
- server.js: 初始化时动态添加本地媒体库静态路由，确保路由在服务器启动前注册
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 聊天语音手动播放句子分割

**已完成功能：**
- 聊天语音手动播放时，进行句子分割
- 长文本按句子分批生成 TTS 并播放

**改动文件：**
- server.js: TTS play action 处理逻辑添加句子分割
- docs/spec/websocket.md: 更新伪代码描述

### 2026-03-29 修复 TTS 语音播报 404 错误

**已修复问题：**
- 显示端语音播报播不出来
- 整点报时无法正常播放
- 原因：TTS 文件路径改为 `uploads/tts/`，但多处代码返回的 URL 仍是 `/uploads/xxx`
- 修复：所有 TTS 相关代码返回正确的 URL `/uploads/tts/${fileName}`

**改动文件：**
- server.js: /api/tts/generate 和 Chat TTS 返回正确的 audioUrl
- core/timeAnnounce.js: 整点报时返回正确的 audioUrl
- core/reminder.js: 提醒功能返回正确的 audioUrl

### 2026-03-29 修复本地媒体库播放 404 错误

**已修复问题：**
- 新增的本地媒体库播放报错 404 Not Found
- 原因：本地媒体库 URL 错误地使用 `/uploads/` 路径，但服务器只映射了 `./uploads` 目录
- 修复：所有本地媒体库统一使用代理 API `/api/media-libraries/{id}/proxy/`

**改动文件：**
- core/media-library.js: LocalProvider.getPublicUrl 使用代理 API
- docs/spec/media-library.md: 更新伪代码描述

### 2026-03-29 AI 聊天助手播放功能

**已完成功能：**
- AI 聊天助手每条消息添加播放按钮
- 点击播放按钮通过 TTS 播放聊天内容

**改动文件：**
- public/js/chat.js: 添加 playMessage 方法，renderHistory 添加播放按钮
- public/css/chat.css: 添加播放按钮样式
- docs/spec/websocket.md: 添加 Chat 模块伪代码描述

### 2026-03-29 TTS 文件存储路径调整

**已完成功能：**
- TTS 生成的音频文件保存到 `uploads/tts/` 文件夹

**改动文件：**
- core/tts.js: 修改 TTS 文件保存路径

### 2026-03-29 控制端媒体库管理

**已完成功能：**
- 控制端添加媒体库 UI（添加/编辑/删除媒体库）
- 支持添加本地磁盘、HTTP远程、SMB网络共享三种类型媒体库
- 编辑媒体库：修改名称、只读模式、设为默认
- 删除媒体库

**改动文件：**
- public/js/media-library.js: 添加 showAddLibraryDialog, showEditLibraryDialog, onTypeChange, addLibraryFromForm, updateLibraryFromForm, deleteLibrary 方法
- public/css/media-library.css: 添加模态框和表单样式
- core/media-library.js: addLibraryFromConfig 支持 HTTP 和 SMB 类型配置
- server.js: POST /api/media-libraries 支持更多参数
- docs/spec/media-library.md: 更新伪代码描述

### 提醒功能
- 提醒类型：临时提醒、每天提醒
- 提醒方式：语音播报、弹窗提示
- 每次提醒重复次数：每次触发时重复播报/弹窗的次数（1-10次）
- 重复提醒：触发后按间隔时间再次提醒
- 编辑提醒：支持编辑已创建的提醒
- 单独测试提醒：可测试单条提醒，支持发送到选中显示端或所有显示端
- 媒体管理界面显示端选择：在媒体管理界面也可以选择显示端

### Bug 修复
- 修复提醒编辑弹窗无法显示问题（`.chat-modal-overlay.active` CSS 样式缺失）

### 配置文件目录
- 配置文件统一迁移到 `config/` 目录
  - `config/config.json` - 主配置文件
  - `config/chat-history.json` - 聊天历史记录
  - `config/media-libraries.json` - 媒体库配置
  - `config/reminders.json` - 提醒配置

### 显示端语音功能
- 显示端支持通过 tts.js 生成语音功能

### 控制端功能
- 合并播放和暂停按钮
- 画面填充和旋转按钮选中状态背景颜色切换
- 本地配置表（保存端口配置、语音服务地址等）
- 控制端媒体列表标注当前播放的媒体
- 保存显示端当前播放列表、画面填充设置
- 服务端重启按钮

### 页面交互
- 界面左侧页签导航

### 控制端查看显示端信息
- 显示端 navigator.userAgent
- 控制端显示列表新增详情按钮

### CSS 文件拆分
- display.html CSS 拆分到 `public/css/display.css`
