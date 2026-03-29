# Web MediaCenter - 变更日志

## [Unreleased]

### 新增
- 待发布的新功能

### 修复
- 待修复的问题

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
