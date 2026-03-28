# 侧边栏导航功能规格

## 概述

控制端页面 (upload.html) 添加左侧导航栏，实现功能模块的快速切换。

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
| 媒体管理 | media | 上传文件、URL上传、服务器资源 | 📁 |
| 显示控制 | display | 显示端选择、显示控制、裁剪 | 🖥️ |
| 提醒设置 | reminder | 提醒设置 | ⏰ |
| AI助手 | chat | AI聊天助手 | 💬 |

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
```javascript
function initSidebar() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const target = item.dataset.target;
            switchPanel(target);
            
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

function switchPanel(targetId) {
    const panels = document.querySelectorAll('.panel');
    panels.forEach(panel => {
        panel.style.display = panel.id === `panel-${targetId}` ? 'block' : 'none';
    });
}
```

### 状态持久化
```javascript
function saveLastPanel(panelId) {
    localStorage.setItem('lastPanel', panelId);
}

function loadLastPanel() {
    const lastPanel = localStorage.getItem('lastPanel') || 'media';
    switchPanel(lastPanel);
    document.querySelector(`[data-target="${lastPanel}"]`)?.classList.add('active');
}
```

## 响应式设计

小屏幕 (max-width: 768px) 时：
- 侧边栏可折叠为图标模式
- 或转为底部导航栏

## 改动文件清单

| 文件 | 改动内容 |
|------|----------|
| public/upload.html | 重构页面布局，添加侧边栏和面板结构 |
| public/css/upload.css | 添加侧边栏样式 |
| public/js/main.js | 添加导航切换逻辑和状态持久化 |

## 实现步骤

1. 修改 upload.html 结构
   - 添加 `<nav class="sidebar">` 侧边栏
   - 将现有模块按分组放入 `<section class="panel">`
   
2. 添加 CSS 样式
   - Flexbox 布局
   - 侧边栏固定定位
   - 导航项样式和激活状态

3. 添加 JavaScript 交互
   - 导航点击切换面板
   - 状态持久化到 localStorage
