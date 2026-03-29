# 显示端设计文档

## 功能概述

显示端是媒体展示的核心组件，负责接收控制端指令并展示媒体内容。

## 画面适配模式

| 模式 | 说明 |
|------|------|
| contain | 适应屏幕，保持比例 |
| height | 高度铺满屏幕 |
| width | 宽度铺满屏幕 |
| crop | 裁剪模式，铺满屏幕 |

## 旋转处理

- 支持 0°、90°、180°、270°
- 旋转 90° 或 270° 时，height/width 模式效果互换

## 裁剪功能

- 裁剪区域使用百分比 (0-100)
- 裁剪框比例与显示端屏幕比例一致
- 只支持等比缩放

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
