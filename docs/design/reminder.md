# 提醒功能设计文档

## 功能概述

提醒功能允许用户在控制端设置定时提醒，服务端在指定时间通过语音播报和/或弹窗提示的方式在显示端提醒用户。

## 提醒类型

| 类型 | 说明 |
|------|------|
| once | 临时提醒，只触发一次，触发后自动删除 |
| daily | 每天提醒，每天固定时间触发 |

## 提醒方式

| 方式 | 说明 |
|------|------|
| voice | 语音播报，使用 TTS 服务生成语音并播放 |
| popup | 弹窗提示，在显示端显示弹窗 |

## 重复设置

- 每次提醒重复次数 (1-10次)
- 重复提醒间隔 (分钟)
- 重复提醒次数 (0=无限)

## 语音提醒增强设计

- 语音提醒确认必须由用户明确确认，不能再使用超时自动确认，避免重复添加。
- 确认播报同时给出“相对时间 + 今天/明天的24小时制时间”，降低歧义。
- 提醒内容支持模板拼接：模板正文 + 前缀 + 后缀，方便统一提醒口吻。
- 确认成功后立即补一条成功语音，明确告知提醒已经创建完成。

## 相关文件

| 文件 | 说明 |
|------|------|
| src/apps/web-mediacenter/modules/reminder/reminder-app-service.js | 服务端提醒逻辑 |
| public/js/reminder.js | 控制端提醒界面 |
| ~/.config/aasc-user/reminders.json | 提醒数据存储 |

## 语音提醒时间解析

- 语音提醒统一复用 `src/core/utils/time-parser.js` 的日期、相对时间、时段和中文数字解析，不再在语音命令模块维护一套仅支持阿拉伯数字的重复规则。
- 支持“下午三点”“明天早上八点”“晚上九点”“三十分钟后”等常用表达，并将识别出的时间片段从提醒内容中移除。
- 未识别到时间时仍默认安排在 5 分钟后，但确认文本必须明确使用默认时间。

## 统一 TTS 路由

提醒触发和单条提醒测试必须复用服务端统一的 `generateTtsWithFallback` 路由。
提醒模块通过初始化依赖接收 TTS 生成器，不直接依赖底层 `tts.generateTTS`，从而在
`tts.device=display` 时优先使用在线显示端原生 TTS，显示端不可用时才根据配置回退
服务器 TTS。这样服务器 TTS 关闭时，使用显示端 TTS 的提醒不会错误访问本地
`127.0.0.1:3001`。

---

# 已完成功能

## 提醒功能
 - ✅已完成 提醒类型：临时提醒、每天提醒
 - ✅已完成 提醒方式：语音播报、弹窗提示
 - ✅已完成 每次提醒重复次数：每次触发时重复播报/弹窗的次数（1-10次）
 - ✅已完成 重复提醒：触发后按间隔时间再次提醒
 - ✅已完成 编辑提醒：支持编辑已创建的提醒
 - ✅已完成 单独测试提醒：可测试单条提醒，支持发送到选中显示端或所有显示端
   - 改动文件：public/js/reminder.js, src/apps/web-mediacenter/modules/reminder/reminder-app-service.js
 - ✅已完成 媒体管理界面显示端选择：在媒体管理界面也可以选择显示端
   - 改动文件：public/js/reminder.js, src/apps/web-mediacenter/modules/reminder/reminder-app-service.js
 - ✅已完成 提醒统一 TTS 路由：提醒触发和单条测试复用服务端显示端优先、服务器回退的 TTS 生成器
   - 改动文件：src/apps/web-mediacenter/modules/reminder/reminder-app-service.js, src/apps/server/boot/server-app.js

## Bug 修复
 - ✅已完成 修复提醒编辑弹窗无法显示问题
   - 问题原因：`.chat-modal-overlay.active` CSS 样式缺失
   - 修复文件：public/css/chat.css
