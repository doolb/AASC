# Web MediaCenter - 变更日志

## [Unreleased]

### 新增
- 待发布的新功能

### 修复
- 待修复的问题

---

## 历史记录

### 2026-03-29 修复 TTS 语音播报 404 错误

**已修复问题：**
- 显示端语音播报播不出来
- 原因：TTS 文件路径改为 `uploads/tts/`，但 API 返回的 URL 仍是 `/uploads/xxx`
- 修复：API 返回正确的 URL `/uploads/tts/${fileName}`

**改动文件：**
- server.js: POST /api/tts/generate 返回正确的 audioUrl

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
