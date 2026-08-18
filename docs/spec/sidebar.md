# 侧边栏导航功能规格

## 概述

控制端页面 (upload.html) 使用左侧导航栏，实现功能模块的快速切换。

## 布局结构

```
┌─────────────────────────────────────────────────────────┐
│  ┌────────────┐  ┌────────────────────────────────────┐ │
│  │            │  │                                    │ │
│  │   侧边栏    │  │           内容区域                 │ │
│  │   导航      │  │        (根据选中显示)              │ │
│  │            │  │                                    │ │
│  │   60px     │  │           flex: 1                  │ │
│  │            │  │                                    │ │
│  └────────────┘  └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 功能模块分组

| 导航项 | ID | 包含模块 | 图标 |
|--------|-----|----------|------|
| 媒体管理 | media | 显示端选择、上传文件、URL上传、服务器资源 | 📁 |
| 显示控制 | display | 显示端选择、显示控制、裁剪、TTS、整点报时 | 🖥️ |
| 提醒设置 | reminder | 提醒表单、提醒列表 | ⏰ |
| AI助手 | chat | AI聊天助手 | 💬 |
| 搜索 | search | 手动搜索、搜索历史 | 🔍 |

## HTML 结构

```html
<body>
    <nav class="sidebar">
        <div class="sidebar-header">
            <span class="logo">MC</span>
        </div>
        <div class="sidebar-nav">
            <button class="nav-item active" data-target="media" title="媒体管理">
                <span class="nav-icon">📁</span>
                <span class="nav-text">媒体</span>
            </button>
            <button class="nav-item" data-target="display" title="显示控制">
                <span class="nav-icon">🖥️</span>
                <span class="nav-text">显示</span>
            </button>
            <button class="nav-item" data-target="reminder" title="提醒设置">
                <span class="nav-icon">⏰</span>
                <span class="nav-text">提醒</span>
            </button>
            <button class="nav-item" data-target="chat" title="AI助手">
                <span class="nav-icon">💬</span>
                <span class="nav-text">助手</span>
            </button>
            <button class="nav-item" data-target="search" title="搜索">
                <span class="nav-icon">🔍</span>
                <span class="nav-text">搜索</span>
            </button>
        </div>
    </nav>
    
    <main class="content">
        <section class="panel" id="panel-media">
            <!-- 媒体管理模块 -->
        </section>
        <section class="panel" id="panel-display" style="display:none;">
            <!-- 显示控制模块 -->
        </section>
        <section class="panel" id="panel-reminder" style="display:none;">
            <!-- 提醒设置模块 -->
        </section>
        <section class="panel" id="panel-chat" style="display:none;">
            <!-- AI助手模块 -->
        </section>
        <section class="panel" id="panel-search" style="display:none;">
            <!-- 搜索模块 -->
        </section>
    </main>
</body>
```

## CSS 样式要点

### 布局
```css
body {
    display: flex;
    min-height: 100vh;
    padding: 0;
}

.sidebar {
    width: 60px;
    background: rgba(0, 0, 0, 0.3);
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
}

.content {
    flex: 1;
    margin-left: 60px;
    padding: 20px;
}
```

### 导航高度约束

```
初始化侧边栏布局:
    侧边栏固定覆盖视口高度
    侧边栏导航区域占用头部之外的剩余高度
    允许导航区域收缩到剩余高度
    当导航项总高度超过可视高度时，仅导航区域出现垂直滚动
    导航区域滚动不影响右侧内容区域和当前面板状态
```

对应 CSS 约束：

```css
.sidebar-nav {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.sidebar-nav::-webkit-scrollbar {
    display: none;
}

.sidebar-nav {
    cursor: grab;
    user-select: none;
}

.sidebar-nav.is-dragging {
    cursor: grabbing;
}
```

### 导航拖动滚动

```
初始化侧边栏:
    获取 .sidebar-nav
    监听 pointerdown:
        记录按下位置和当前 scrollTop
        调用 setPointerCapture(pointerId)
    监听 pointermove:
        若指针已移动超过阈值:
            scrollTop = 按下时 scrollTop - 垂直位移
            标记正在拖动
            阻止本次拖动产生误点击
    监听 pointerup/pointercancel:
        释放指针捕获
        清理拖动状态
```

拖动只改变左侧导航的 `scrollTop`，不改变当前页签和右侧面板；未超过移动阈值的点击仍按原有导航逻辑执行。

### 右侧内容区拖动滚动

```
初始化右侧内容区:
    获取 .content
    仅当 pointerdown 目标就是 .content 空白背景时开始拖动
    pointermove 根据垂直位移更新 window.scrollY
    pointerup/pointercancel 清理拖动状态
    .panel、.section 和所有表单/媒体/链接控件不启动拖动
```

右侧拖动只改变页面纵向滚动位置，不改变当前面板、按钮状态或表单输入内容。

### 导航项
```css
.nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.3s ease;
}

.nav-item:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.nav-item.active {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
    border-left: 3px solid #00d2ff;
}
```

## JavaScript 交互

### 导航切换
```
function initSidebar():
    获取所有 .nav-item
    
    为每个 nav-item 添加点击事件:
        获取 data-target 属性
        调用 switchPanel(target)
        
        移除所有 nav-item 的 active 类
        为当前项添加 active 类

function switchPanel(targetId):
    获取所有 .panel
    对于每个 panel:
        如果 panel.id === 'panel-' + targetId:
            显示 panel
        否则:
            隐藏 panel
```

### 状态持久化
```
function saveLastPanel(panelId):
    localStorage.setItem('lastPanel', panelId)

function loadLastPanel():
    lastPanel = localStorage.getItem('lastPanel') || 'media'
    调用 switchPanel(lastPanel)
    为对应 nav-item 添加 active 类
```

## 面板内容

### panel-media
- 显示端选择
- 上传文件 (图片/GIF、视频)
- URL上传
- 服务器资源列表

### panel-display
- 显示端选择
- 显示控制 (画面填充、播放控制、进度、音量)
- 语音播报 (TTS)
- 整点报时设置
- 画面裁剪区域

### panel-reminder
- 提醒表单 (内容、时间、类型、方式、重复设置)
- 提醒列表

### panel-chat
- AI聊天助手界面
- 聊天历史
- 模板管理
- 设置面板

## 弹窗组件

### featureModal
显示端信息弹窗，展示浏览器详情和功能支持。

### chatTemplateModal
聊天模板管理弹窗。

### chatConfigModal
聊天设置弹窗。

### editReminderModal
编辑提醒弹窗。

## 相关文件

| 文件 | 说明 |
|------|------|
| public/upload.html | 页面结构和布局 |
| public/css/upload.css | 侧边栏和面板样式 |
| public/js/main.js | 导航切换逻辑 |
