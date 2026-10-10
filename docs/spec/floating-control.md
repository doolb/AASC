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
    clearMedia(),              // 清空所选显示端当前媒体
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

## 竖屏底部导航避让（2026-10-10，已确认）

```text
portrait:
    floating-control.bottom = 20px + 68px + safe-area-inset-bottom
    self-test-trigger.bottom = 80px + 68px + safe-area-inset-bottom
    floating-recording-pause保持相对控制容器bottom120px
landscape -> 保持原位置和三按钮间距
浏览器 -> 三按钮rect.bottom < sidebar.rect.top，切换方向仍满足布局
```

2026-10-10 发布验证：本轮对应功能已纳入code56，最终21文件93项定向通过、无跳过；LAN/WAN签名清单及全部组件HTTP大小/哈希、精确旧版本清理通过。手机实际交互另验收。


## 清空当前媒体（2026-10-10，已实现）

```text
已有声明：FloatingControl.selectedDisplayId、WebSocketManager、stopPlaylist、TextMediaPlayer、persistDisplayState
新增定义：clearMedia 控制动作；服务端权威清空结果
点击播放按钮后的清空媒体按钮：
    读取快捷面板选中的显示端 → 目标
    目标为空或 WebSocket 未连接 → 提示并终止
    向服务端发送 type=control、displayId=目标、action=clearMedia
服务端接收：
    校验目标显示端 → 目标状态
    保存空状态成功后，取消目标的媒体文本语音上下文
    当前媒体/列表/进度/临时媒体清空，播放状态设为停止 → 空状态
    持久化空状态 → 转发清空命令 → 广播权威清空结果
显示端接收：
    失效旧媒体异步加载 → 停止列表/文本/滚动 → 暂停音视频并释放引用
    隐藏当前媒体、清除文件名和媒体状态 → 保留角色/聊天
控制端收到权威结果：
    结果对应当前选择 → 重置播放、分页、批量、媒体库标记与裁剪预览
    其他显示端结果 → 不改当前显示
刷新/重连：
    从持久化空状态恢复 → 不播放已清空媒体
```

修改 upload.html、js/floating-control.js、js/websocket.js、display.html、js/text-media-player.js、服务端 server-app.js；验证媒体类型、列表停止、目标隔离、断线提示与刷新恢复。

```text
空状态字段：currentMedia/currentPlaylist/currentMediaProgress/currentTextProgress/lastTempMedia=null，isPlaying=false
清空结果：type=mediaClearResult，displayId，success，失败时message
服务端控制入口先处理clearMedia并提前返回，未知目标回传失败
服务端收到媒体进度/列表/文本进度/临时信息/播放状态：
    当前媒体显式null且无列表 → 丢弃，不能覆盖持久化空状态或重新显示控制面板
TextMediaPlayer.clear：
    失效加载和播报 → 删除source/rawText/pages/句子/列表/路由 → stopped → 清空DOM并上报0页
showMedia：
    递增媒体加载序号；MHTML使用async/await加载和代理回退，每次await后检查序号
clearCurrentMedia：
    递增加载序号 → 停止恢复定时器/动态填充/列表/网页截图和滚动
    清空文本播放器 → 删除元素回调和src/srcdoc → 设置类型为空、暂停标志并上报停止
控制端收到成功：只在结果目标对应当前选择时调用resetMediaControls
控制端收到displayState：若显式空媒体且无列表，则同样reset并提前返回媒体恢复部分
resetMediaControls：停止旧预览重试，释放图片/视频src、预览回调及临时缓存；回到未播放状态
```

```text
恢复显示端空快照 → clearCurrentMedia，清除断线期间保留的旧画面
文本播放器清理音频 → 仅使用activeAudio，未持有文本音频时不触碰同页聊天ttsAudio
严格保存空状态：persistDisplayState携带requireSave=true
    updateDisplayStateById复制旧状态表 → 新表 → set返回写盘结果
    写盘失败且要求严格保存 → 恢复旧表并抛出异常，媒体保持原状态
    其他调用保留原有非严格行为
控制端延迟预览恢复回调 → 仅在媒体重置序号仍相同时执行
```

验证：tests/floating-media-clear.test.js 新增7项（正式浏览器交互与真实媒体DOM、严格磁盘状态恢复、加载/播报隔离）；共12文件103/103、零跳过。服务包待打包发布，servicePackage=true；角色与聊天保留。
