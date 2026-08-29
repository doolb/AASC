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
- APK 原生 ASR/TTS 大小核并发数量设置与独立“优先大核”开关

### 裁剪预览
- 实时预览裁剪效果
- 裁剪框与显示端屏幕比例一致
- 支持拖拽移动和等比缩放
- 支持旋转预览

### 搜索页签
- 显示搜索历史记录
- 支持手动搜索
- 搜索记录可点击播放、删除、清空

## 控制端主题与 UI 控件分类

控制端使用统一的主题状态和 UI 语义标记管理视觉样式。首期提供深色、浅色两种主题，默认保持现有深色主题；主题只保存在当前浏览器，不进入服务器配置，也不影响显示端。

UI 分类按交互和视觉职责归并：页面/区块标题、文本/标签、Tip、导航项、普通按钮、选择按钮、关闭按钮、上传入口、文本/数字/时间/密码输入、下拉框、单选框、复选框、开关、滑条、弹窗、状态/徽章、进度和 Toast。按钮颜色、主次危险状态属于同一按钮类型的样式变体。

实现要求：

- 通过 `data-theme` 和 CSS 自定义属性集中定义背景、文字、边框、强调色、状态色和阴影。
- 通过 `data-ui-type` 给静态及动态控件增加稳定语义，不改变已有 ID、事件绑定和业务协议。
- 动态插入的弹窗、任务控件、媒体库控件和 Toast 必须能继承当前主题。
- 主题选择变化后立即生效，刷新页面后恢复上次选择；非法或不可读配置回退到深色主题。

## 页面布局

采用左侧固定宽度侧边栏 + 右侧自适应内容区的布局结构。

## APK CPU 并发控制

控制页在现有“语音识别设备”“语音生成设备”区域下方补充 APK 原生大小核并发设置，只负责编辑服务器保存的 `cpuAffinity`，不直接填写 CPU 编号。

交互要求：

- ASR、TTS 各自提供 `bigCoreCount` 和 `littleCoreCount` 两个数字输入框，默认显示 `1`。
- ASR、TTS 各自提供 `preferBigCores` 复选开关，默认关闭；开关只影响对应引擎的 CPU 选择顺序。
- 页面初始化时调用 `GET /api/config/cpuAffinity`，把服务器规范化后的配置回填到 4 个输入框和 2 个开关。
- 用户保存时对输入做前端规范化：仅发送非负整数；任一引擎如果被清成 `0/0`，前端自动补成至少 1 个槽位，避免请求被服务端拒绝。
- 控件保存走 `POST /api/config/cpuAffinity`，成功后更新状态文案；服务端广播 `cpuAffinityChanged` 后，控制端也要同步刷新输入框，避免多个控制页配置漂移。
- UI 风格沿用现有 `control-item`、`control-buttons`、状态文案和 toast，不额外引入独立面板或重复的设备路由按钮。

### 左侧导航高度适配

左侧导航固定覆盖视口，但导航入口数量可能随内置功能和动态注册组增加。当入口总高度超过窗口可视高度时，导航区域应独立出现垂直滚动条，保证所有入口可访问，同时不推动或影响右侧内容区。

实现约束：

- `.sidebar-nav` 占用侧栏头部之外的剩余高度。
- `.sidebar-nav` 允许在 flex 布局中收缩，并对超出内容启用垂直滚动。
- 入口数量未超出时保持现有视觉和交互不变。

## 相关文件

| 文件 | 说明 |
|------|------|
| public/upload.html | 控制端页面 |
| public/css/upload.css | 控制端样式 |
| public/js/controls.js | 控制逻辑 |
| public/js/crop.js | 裁剪功能 |
| public/js/media-list.js | 媒体列表 |
| public/js/ui-theme.js | 主题状态和 UI 语义分类 |
| public/css/theme.css | 主题变量和主题覆盖样式 |

---

# 已完成功能

## 控制端布局
 - ✅已完成 [2026-08-18][2026-08-18] 左侧页签入口过多时保持在屏幕内
   - 根因：`.sidebar-nav` 只有剩余空间声明，没有 flex 收缩和垂直滚动约束，入口数量增加后内容溢出固定侧栏。
   - 修复：导航区域增加 `min-height: 0` 与 `overflow-y: auto`，仅左侧导航滚动，右侧面板布局不变。
   - 自测：`node --test tests/sidebar-layout.test.js` 通过。
 - ✅已完成 [2026-08-18][2026-08-18] 左侧导航支持按住鼠标拖动滚动
   - 实现：使用 Pointer Events 监听按下、移动、抬起和取消，拖动时根据垂直位移更新导航区域 `scrollTop`。
   - 交互：移动超过 6px 才进入拖动状态，拖动结束后抑制误点击；未超过阈值仍按原有页签点击逻辑执行。
   - 修复：仅在确认进入拖动状态后捕获指针，普通点击不会被导航容器截获。
   - 样式：导航显示 grab/grabbing 光标并禁止拖动过程中的文字选择。
   - 自测：`node --test tests/sidebar-layout.test.js`、`node --check src/apps/web-mediacenter/ui/public/js/main.js` 通过。
 - ✅已完成 [2026-08-18][2026-08-18] 右侧内容区空白背景支持拖动页面滚动
   - 实现：仅当 pointerdown 目标为 `.content` 本身时启动拖动，按垂直位移更新 `window.scrollY`。
   - 兼容：`.panel`、`.section` 及按钮、表单、图片、视频、iframe 等内部元素不会启动拖动，不影响原有操作。
   - 自测：`node --test tests/sidebar-layout.test.js`、`node --check src/apps/web-mediacenter/ui/public/js/main.js` 通过。

## 控制端功能
 - ✅已完成 裁剪框操作自动同步画面填充为裁剪模式
   - 改动文件：public/js/crop.js
   - 功能：拖拽/缩放/重置裁剪框时，若当前填充模式非裁剪，自动切为裁剪模式（按钮高亮 + 下发 fit='crop'），保证服务端持久化 fit='crop'，显示端刷新/重连后裁剪区域不丢失
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
