# 浮动控制面板实现文档

## 模块概述

浮动控制面板 (`public/js/floating-control.js`) 提供全局可访问的显示端控制功能，固定在页面右下角，可在所有页面使用。

## 核心功能

### 1. 模块结构

```
FloatingControl = {
    isOpen: boolean,           // 面板是否打开
    selectedDisplayId: string, // 当前选中的显示端ID
    isPlaying: boolean,        // 是否正在播放
    currentFit: string,        // 当前画面填充模式
    
    init(),                    // 初始化
    toggle(),                  // 切换面板显示
    loadState(),               // 加载保存的状态
    saveState(),               // 保存状态到localStorage
    updateDisplayList(),       // 更新显示端列表
    selectDisplay(displayId),  // 选择显示端
    setSelectedDisplay(id),    // 设置选中的显示端
    togglePlay(),              // 播放/暂停
    setPlayingState(playing),  // 设置播放状态
    setVolume(value),          // 设置音量
    updateVolume(value),       // 更新音量显示
    setFit(fit),               // 设置画面填充
    setFitMode(fit),           // 设置填充模式
    playByName()               // 按文件名播放
}
```

### 2. 初始化流程

```
init():
    调用 loadState() 恢复上次状态
    调用 updateDisplayList() 填充显示端列表
```

### 3. 状态持久化

```
loadState():
    从 localStorage 读取:
        - floatingControl_displayId: 选中的显示端ID
        - floatingControl_fit: 画面填充模式

saveState():
    保存到 localStorage:
        - floatingControl_displayId: 当前选中的显示端ID
        - floatingControl_fit: 当前填充模式
```

### 4. 显示端列表更新

```
updateDisplayList():
    获取显示端列表容器
    清空现有选项
    
    调用 window.DisplayList.getDisplays() 获取显示端列表
    遍历显示端列表:
        创建选项元素
        设置 data-id 和文本
        绑定点击事件
    
    恢复之前选中的显示端
```

### 5. 显示端选择

```
selectDisplay(displayId):
    设置 selectedDisplayId
    更新选中状态样式
    调用 DisplayList.select(displayId)
    保存状态

setSelectedDisplay(id):
    设置 selectedDisplayId
    更新选中状态样式
```

### 6. 播放控制

```
togglePlay():
    如果没有选中显示端:
        显示提示 "请先选择显示端"
        返回
    
    发送控制命令:
        type: 'control'
        action: isPlaying ? 'pause' : 'play'

setPlayingState(playing):
    设置 isPlaying = playing
    更新播放按钮图标
```

### 7. 音量控制

```
setVolume(value):
    如果没有选中显示端:
        显示提示 "请先选择显示端"
        返回
    
    发送控制命令:
        type: 'control'
        action: 'volume'
        value: value

updateVolume(value):
    更新音量滑块值
    更新音量显示文本
```

### 8. 画面填充控制

```
setFit(fit):
    如果没有选中显示端:
        显示提示 "请先选择显示端"
        返回
    
    发送控制命令:
        type: 'control'
        action: 'fit'
        value: fit
    
    更新按钮状态
    保存状态

setFitMode(fit):
    设置 currentFit = fit
    更新按钮激活状态
```

### 9. 按文件名播放

```
playByName():
    获取输入框中的文件名
    如果为空:
        显示提示 "请输入文件名"
        返回
    
    如果没有选中显示端:
        显示提示 "请先选择显示端"
        返回
    
    发送语音命令:
        type: 'voiceCommand'
        displayId: selectedDisplayId
        text: "播放{文件名}"
    
    清空输入框
```

## HTML 结构

```html
<div class="floating-control" id="floatingControl">
    <div class="floating-control-toggle" onclick="FloatingControl.toggle()">
        <span class="toggle-icon">⚙️</span>
    </div>
    <div class="floating-control-panel" id="floatingControlPanel">
        <div class="floating-control-header">
            <span>快捷控制</span>
            <button class="floating-close" onclick="FloatingControl.toggle()">×</button>
        </div>
        <div class="floating-control-body">
            <!-- 显示端选择 -->
            <div class="floating-control-item">
                <label>显示端</label>
                <div class="floating-display-list" id="floatingDisplayList"></div>
            </div>
            
            <!-- 播放控制 -->
            <div class="floating-control-item">
                <label>播放</label>
                <button onclick="FloatingControl.togglePlay()">▶</button>
            </div>
            
            <!-- 音量控制 -->
            <div class="floating-control-item">
                <label>音量</label>
                <input type="range" min="0" max="100" value="50" 
                       onchange="FloatingControl.setVolume(this.value)">
                <span id="floatingVolumeValue">50</span>
            </div>
            
            <!-- 画面填充 -->
            <div class="floating-control-item">
                <label>填充</label>
        <button onclick="FloatingControl.setFit('contain')">适应</button>
        <button onclick="FloatingControl.setFit('cover')">填充</button>
        <button onclick="FloatingControl.setFit('dynamic')">动态</button>
        <button onclick="FloatingControl.setFit('fill')">拉伸</button>
            </div>
            
            <!-- 快速播放 -->
            <div class="floating-control-item">
                <label>播放文件</label>
                <input type="text" placeholder="输入文件名">
                <button onclick="FloatingControl.playByName()">播放</button>
            </div>
        </div>
    </div>
</div>
```

## CSS 样式

```css
.floating-control {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 1000;
}

.floating-control-toggle {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(26, 26, 46, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
}

.floating-control-panel {
    position: absolute;
    bottom: 60px;
    right: 0;
    width: 280px;
    background: rgba(26, 26, 46, 0.95);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    display: none;
    overflow: hidden;
}

.floating-control-panel.show {
    display: block;
    animation: slideUp 0.3s ease;
}
```

## 与其他模块的集成

### 1. DisplayList 模块

```
DisplayList.render():
    渲染完成后调用 FloatingControl.updateDisplayList()

DisplayList.select(id):
    选择后调用 FloatingControl.setSelectedDisplay(id)
```

### 2. WebSocket 模块

```
WebSocketManager.handleMessage(data):
    当收到 displayState 时:
        调用 FloatingControl.setFitMode(data.state.fit)
        调用 FloatingControl.updateVolume(data.state.volume)
        调用 FloatingControl.setPlayingState(data.state.isPlaying)
```

### 3. main.js 初始化

```
document.addEventListener('DOMContentLoaded'):
    调用 FloatingControl.init()
```

## 相关文件

| 文件 | 说明 |
|------|------|
| public/js/floating-control.js | 浮动控制面板模块 |
| public/upload.html | 浮动面板 HTML 结构 |
| public/css/upload.css | 浮动面板样式 |
| public/js/display-list.js | 显示端列表模块 |
| public/js/websocket.js | WebSocket 消息处理 |
| public/js/main.js | 初始化入口 |
