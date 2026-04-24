# 控制端设计文档

## 功能概述

控制端是媒体管理和显示控制的核心界面，支持文件上传、URL发送、显示端选择和画面控制。

## 功能模块

### 媒体管理
- 上传图片、GIF、视频文件
- URL 直接发送
- 服务器资源列表管理
- 文件删除

### 显示控制
- 显示端选择
- 画面填充模式切换
- 视频播放/暂停控制
- 播放进度控制
- 音量控制

### 裁剪预览
- 实时预览裁剪效果
- 裁剪框与显示端屏幕比例一致
- 支持拖拽移动和等比缩放
- 支持旋转预览

### 搜索页签
- 显示搜索历史记录
- 支持手动搜索
- 搜索记录可点击播放、删除、清空

## 页面布局

采用左侧固定宽度侧边栏 + 右侧自适应内容区的布局结构。

## 相关文件

| 文件 | 说明 |
|------|------|
| public/upload.html | 控制端页面 |
| public/css/upload.css | 控制端样式 |
| public/js/controls.js | 控制逻辑 |
| public/js/crop.js | 裁剪功能 |
| public/js/media-list.js | 媒体列表 |

---

# 已完成功能

## 控制端功能
 - ✅已完成 合并播放和暂停按钮
   - 改动文件：public/upload.html, public/js/controls.js, public/css/upload.css
   - 功能：将两个按钮合并为一个切换按钮，自动更新按钮文字和背景颜色
 - ✅已完成 画面填充和旋转按钮选中状态背景颜色切换
   - 改动文件：public/upload.html, public/js/controls.js, public/js/crop.js, public/css/upload.css
   - 功能：按钮添加 data-fit/data-rotation 属性，选中状态显示蓝色渐变背景
 - ✅已完成 本地配置表
   - 功能：保存端口配置、语音服务地址、语音服务端口、媒体库配置、媒体库文件夹路径
 - ✅已完成 控制端媒体列表标注当前播放的媒体
   - 改动文件：public/js/media-list.js, public/css/upload.css
   - 功能：添加 `.playing` 类和徽章样式，滚动到当前播放项
 - ✅已完成 保存显示端当前播放列表、画面填充设置
   - 功能：服务端重启后，可以恢复到上次播放的状态，区分不同的显示端，音量状态也保留
 - ✅已完成 服务端重启按钮
   - 改动文件：server.js, public/upload.html, public/js/controls.js
   - 功能：点击后发送重启请求，使用 spawn 启动新进程后退出实现自重启

## 页面交互
 - ✅已完成 界面左侧页签导航
   - 改动文件：public/upload.html, public/css/upload.css, public/js/main.js
   - 功能：左侧固定宽度侧边栏 + 右侧自适应内容区，使用 localStorage 记住用户最后选中的面板

## 文件上传
 - ✅已完成 [2026-03-28][2026-03-28] 上传文件功能修复
   - 改动文件：public/js/upload.js
   - 问题：Upload 对象未导出到 window，导致 main.js 中 window.Upload.init() 无法执行
   - 修复：添加 window.Upload = Upload 导出

## AI 聊天助手
 - ✅已完成 [2026-03-29][2026-03-29] 语音漏播和重复播放问题修复
   - 改动文件：src/external/tts/tts-service.js, server.js, src/apps/web-mediacenter/modules/reminder/reminder-app-service.js, src/apps/web-mediacenter/modules/time/time-announce-app-service.js
   - 问题：所有 TTS 写入同一个文件 temp_tts.wav，并发时后一个覆盖前一个，导致中间语音丢失
   - 修复：使用唯一文件名 tts_{timestamp}_{random}.wav 生成 TTS，添加定期清理旧文件功能
