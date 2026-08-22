# 显示端选择功能实现文档

## 概述

显示端选择功能支持单选、全选和自适应三种模式，用于控制媒体下发的目标显示端。

## 数据结构

### 选择模式枚举

```javascript
const SelectionMode = {
    SINGLE: 'single',     // 单选模式
    ALL: 'all',           // 全选模式
    ADAPTIVE: 'adaptive'  // 自适应模式
};
```

### 显示端数据结构

```javascript
// 显示端对象
{
    id: string,           // 显示端唯一标识
    ip: string,           // IP 地址
    canvasSize: {         // 画布尺寸
        width: number,
        height: number
    },
    rotation: number,     // 旋转角度 (0, 90, 180, 270)
    browserInfo: {...}    // 浏览器信息
}
```

## DisplayList 模块扩展

### 新增属性

```javascript
const DisplayList = {
    list: [],                    // 显示端列表
    selectionMode: 'single',     // 选择模式：single/all/adaptive
    
    // ... 其他现有方法
};
```

### 新增方法

#### setSelectionMode(mode)

设置选择模式

```javascript
function setSelectionMode(mode) {
    // 验证模式有效性
    if (mode !== 'single' && mode !== 'all' && mode !== 'adaptive') {
        return;
    }
    
    // 更新选择模式
    this.selectionMode = mode;
    
    // 更新 UI 显示
    this.renderSelectionMode();
    
    // 如果切换到单选模式，确保有选中的显示端
    if (mode === 'single' && !window.currentDisplayId && this.list.length > 0) {
        this.select(this.list[0].id);
    }
}
```

#### getSelectedDisplayIds(mediaRatio)

根据选择模式获取目标显示端 ID 列表

```javascript
function getSelectedDisplayIds(mediaRatio) {
    // mediaRatio: 媒体宽高比 (width / height)
    
    switch (this.selectionMode) {
        case 'single':
            // 单选模式：返回当前选中的显示端
            return window.currentDisplayId ? [window.currentDisplayId] : [];
            
        case 'all':
            // 全选模式：返回所有显示端
            return this.list.map(d => d.id);
            
        case 'adaptive':
            // 自适应模式：根据媒体比例匹配显示端
            return this.getAdaptiveDisplayIds(mediaRatio);
            
        default:
            return [];
    }
}
```

#### getAdaptiveDisplayIds(mediaRatio)

自适应模式：根据媒体比例匹配显示端方向

```javascript
function getAdaptiveDisplayIds(mediaRatio) {
    // mediaRatio > 1: 横向媒体
    // mediaRatio < 1: 纵向媒体
    // mediaRatio = 1: 正方形媒体，发送到所有显示端
    
    const isLandscapeMedia = mediaRatio > 1;
    const isPortraitMedia = mediaRatio < 1;
    
    return this.list.filter(display => {
        // 获取显示端有效方向
        const isLandscapeDisplay = this.isDisplayLandscape(display);
        
        if (isLandscapeMedia) {
            // 横向媒体发送到横向显示端
            return isLandscapeDisplay;
        } else if (isPortraitMedia) {
            // 纵向媒体发送到纵向显示端
            return !isLandscapeDisplay;
        } else {
            // 正方形媒体发送到所有显示端
            return true;
        }
    }).map(d => d.id);
}
```

#### isDisplayLandscape(display)

判断显示端是否为横向（考虑旋转角度）

```javascript
function isDisplayLandscape(display) {
    const { width, height } = display.canvasSize;
    const rotation = display.rotation || 0;
    
    // 判断原始方向
    let isLandscape = width >= height;
    
    // 90° 或 270° 旋转时，方向互换
    if (rotation === 90 || rotation === 270) {
        isLandscape = !isLandscape;
    }
    
    return isLandscape;
}
```

#### renderSelectionMode()

渲染选择模式 UI

```javascript
function renderSelectionMode() {
    // 更新选择模式按钮状态
    document.querySelectorAll('[data-selection-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.selectionMode === this.selectionMode);
    });
    
    // 更新显示端列表样式
    this.render();
}
```

### 修改 render() 方法

```javascript
function render() {
    this.renderToContainer('displayList');
    this.renderToContainer('mediaDisplayList');
    
    // 渲染选择模式按钮
    this.renderSelectionMode();
    
    if (window.FloatingControl) {
        window.FloatingControl.updateDisplayList();
    }
    
    // 单选模式下自动选择第一个显示端
    if (this.selectionMode === 'single' && !window.currentDisplayId && this.list.length > 0) {
        this.select(this.list[0].id);
    }
}
```

### 修改 renderToContainer() 方法

```javascript
function renderToContainer(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (this.list.length === 0) {
        container.innerHTML = '<div class="empty-list">暂无显示端连接</div>';
        return;
    }
    
    // 添加选择模式按钮
    let headerHtml = `
        <div class="selection-mode-bar">
            <button class="selection-mode-btn ${this.selectionMode === 'single' ? 'active' : ''}" 
                    data-selection-mode="single" onclick="DisplayList.setSelectionMode('single')">
                单选
            </button>
            <button class="selection-mode-btn ${this.selectionMode === 'all' ? 'active' : ''}" 
                    data-selection-mode="all" onclick="DisplayList.setSelectionMode('all')">
                全选
            </button>
            <button class="selection-mode-btn ${this.selectionMode === 'adaptive' ? 'active' : ''}" 
                    data-selection-mode="adaptive" onclick="DisplayList.setSelectionMode('adaptive')">
                自适应
            </button>
        </div>
    `;
    
    // 渲染显示端列表
    let listHtml = this.list.map(d => {
        // 根据选择模式决定选中状态
        let isActive = false;
        if (this.selectionMode === 'single') {
            isActive = d.id === window.currentDisplayId;
        } else if (this.selectionMode === 'all') {
            isActive = true;
        } else if (this.selectionMode === 'adaptive') {
            // 自适应模式下不显示选中状态
            isActive = false;
        }
        
        // ... 现有的显示端项渲染逻辑
    }).join('');
    
    container.innerHTML = headerHtml + listHtml;
}
```

## WebSocketManager 模块扩展

### 修改 sendMedia() 方法

```javascript
function sendMedia(mediaData) {
    // 获取媒体比例
    const mediaRatio = this.getMediaRatio(mediaData);
    
    // 获取目标显示端列表
    const displayIds = window.DisplayList.getSelectedDisplayIds(mediaRatio);
    
    if (displayIds.length === 0) {
        showToast('没有可用的显示端', 'error');
        return;
    }
    
    // 发送到所有目标显示端
    displayIds.forEach(displayId => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'media',
                displayId: displayId,
                media: mediaData
            }));
        }
    });
    
    showToast(`已发送到 ${displayIds.length} 个显示端`, 'success');
}
```

### 新增 getMediaRatio() 方法

```javascript
async function getMediaRatio(mediaData) {
    if (mediaData.width && mediaData.height) {
        // 如果已有尺寸信息，直接计算
        return mediaData.width / mediaData.height;
    }
    
    // 否则从 URL 加载媒体获取尺寸
    return new Promise((resolve) => {
        if (mediaData.mediaType === 'video') {
            const video = document.createElement('video');
            video.onloadedmetadata = () => {
                resolve(video.videoWidth / video.videoHeight);
            };
            video.onerror = () => resolve(1);
            video.src = mediaData.url;
        } else {
            const img = new Image();
            img.onload = () => {
                resolve(img.naturalWidth / img.naturalHeight);
            };
            img.onerror = () => resolve(1);
            img.src = mediaData.url;
        }
    });
}
```

## 服务端修改 (server.js)

### 新增批量发送消息类型

```javascript
// 处理控制端消息
ws.on('message', (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'media') {
        // 单个显示端发送（现有逻辑）
        const displayData = displayClients.get(data.displayId);
        if (displayData) {
            displayData.state.currentMedia = data.media;
            config.updateDisplayState(displayData.ip, { currentMedia: data.media });
            sendToDisplay(data.displayId, data.media);
        }
    } else if (data.type === 'mediaBatch') {
        // 批量发送到多个显示端
        const displayIds = data.displayIds || [];
        displayIds.forEach(displayId => {
            const displayData = displayClients.get(displayId);
            if (displayData) {
                displayData.state.currentMedia = data.media;
                config.updateDisplayState(displayData.ip, { currentMedia: data.media });
                sendToDisplay(displayId, data.media);
            }
        });
    }
    // ... 其他消息处理
});
```

## UI 样式

### 选择模式按钮样式

```css
.selection-mode-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
}

.selection-mode-btn {
    flex: 1;
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.selection-mode-btn:hover {
    background: rgba(255, 255, 255, 0.15);
}

.selection-mode-btn.active {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: #fff;
}
```

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/display-list.js | 显示端列表管理，新增选择模式 |
| public/js/websocket.js | WebSocket 管理，修改 sendMedia 方法 |
| public/css/upload.css | 选择模式按钮样式 |
| server.js | 服务端，新增批量发送消息类型 |

## 目标显示端批量状态隔离

```text
select(displayId):
    currentDisplayId = displayId
    清理 MediaLibrary 的批量面板、浮动面板、显示控制面板和临时预览缓存
    发送 getState(displayId)

收到 playlistProgress:
    如果 message.displayId != currentDisplayId:
        丢弃
    否则更新当前批量面板

收到 displayState:
    如果 state.currentPlaylist 存在:
        恢复该显示端当前批量项
    否则:
        隐藏批量面板
```
