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

## 旋转处理

- 支持 0°、90°、180°、270°
- 旋转 90° 或 270° 时，height/width 模式效果互换

### UI四角布局

旋转后UI元素保持在以0度为基准的画面四角，根据新重力方向调整文字垂直方向。

| 位置 | UI元素 | 说明 |
|------|--------|------|
| 左上 | connectionStatus | 连接状态 |
| 右上 | timeDisplay | 时间显示 |
| 左下 | fileNameDisplay | 文件名 |
| 右下 | monitor-wrapper + voiceStatus | 音频可视化 + 语音状态 |

### 旋转文字

| 旋转角度 | 重力方向 | 文字方向 |
|----------|----------|----------|
| 0° | 向下 | 水平，从左到右 |
| 90° | 向右 | 竖向，从上到下（writingMode: vertical-rl + rotate(180deg)） |
| 180° | 向上 | 水平，翻转180度 |
| 270° | 向左 | 竖向，从上到下（writingMode: vertical-rl） |


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
   - 90度/270度使用 writingMode: vertical-rl 实现竖向文字
   - 180度使用 transform: rotate(180deg) 翻转文字
   - connectionStatus 和 monitor-wrapper 纳入旋转管理
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
   - 改动文件：src/apps/server/boot/server-app.js（/api/display-version 接口）、public/display.html（前端轮询，未改动）
   - 实现文档：docs/spec/api.md
