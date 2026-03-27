# Web MediaCenter - 代码规范

## 1. 项目结构

```
web-mediacenter/
├── server.js           # 服务器入口
├── package.json        # 项目配置
├── public/             # 静态文件
│   ├── upload.html     # 控制端页面
│   └── display.html    # 显示端页面
├── uploads/            # 上传文件存储
└── docs/               # 文档
    ├── spec.md         # 规格文档
    ├── usage.md        # 使用说明
    └── rules.md        # 代码规范
```

## 2. JavaScript 规范

### 2.1 命名约定

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| 变量 | camelCase | `currentFit`, `mediaRatio` |
| 常量 | UPPER_SNAKE_CASE | `UPLOADS_DIR`, `PORT` |
| 函数 | camelCase | `applyCrop()`, `sendControl()` |
| 类/构造函数 | PascalCase | `WebSocket`, `Map` |
| 私有变量 | _前缀 | `_internalState` |
| 事件处理 | on前缀 | `onCropMouseDown()` |

### 2.2 变量声明

```javascript
// 推荐: 使用 const/let
const container = document.getElementById('mediaContainer');
let currentFit = 'contain';

// 不推荐: 使用 var
var oldStyle = 'deprecated';

// 多个变量声明
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
```

### 2.3 函数定义

```javascript
// 推荐: 函数声明
function applyCrop() {
    // ...
}

// 推荐: 箭头函数 (回调)
const handler = (e) => {
    e.preventDefault();
};

// 推荐: 方法简写
const obj = {
    send(data) {
        this.ws.send(JSON.stringify(data));
    }
};
```

### 2.4 异步处理

```javascript
// 推荐: async/await
async function loadMediaList() {
    try {
        const res = await fetch('/media-list');
        const data = await res.json();
        renderMediaList(data.list);
    } catch (err) {
        console.error('加载失败:', err);
    }
}

// 不推荐: 回调地狱
fetch('/media-list')
    .then(res => res.json())
    .then(data => {
        fetch('/other')
            .then(res => res.json())
            .then(other => {
                // ...
            });
    });
```

### 2.5 错误处理

```javascript
// 推荐: try-catch 包裹可能出错的代码
try {
    const data = JSON.parse(message);
    handleData(data);
} catch (e) {
    console.error('解析消息失败:', e);
}

// 推荐: 提前返回
function sendControl(action, value) {
    if (!currentDisplayId) {
        showToast('请先选择显示端', 'error');
        return;
    }
    // ... 发送逻辑
}
```

## 3. HTML 规范

### 3.1 文档结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>页面标题</title>
    <style>
        /* CSS 样式 */
    </style>
</head>
<body>
    <!-- HTML 内容 -->
    <script>
        // JavaScript 代码
    </script>
</body>
</html>
```

### 3.2 ID 和 Class 命名

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| ID | camelCase | `#mediaContainer`, `#cropBox` |
| Class | kebab-case | `.crop-preview-media`, `.control-btn` |
| 状态类 | 单词 | `.active`, `.rotate-90` |

### 3.3 事件绑定

```html
<!-- 推荐: 使用 addEventListener -->
<button id="playBtn">播放</button>

<script>
document.getElementById('playBtn').addEventListener('click', playMedia);
</script>

<!-- 可接受: 简单操作使用内联 -->
<button onclick="resetCrop()">重置裁剪</button>
```

## 4. CSS 规范

### 4.1 选择器

```css
/* 推荐: 类选择器 */
.crop-box {
    position: absolute;
}

/* 避免: 过深嵌套 */
.container .section .item .title {
    /* 不推荐 */
}

/* 推荐: BEM 风格 */
.crop-box__handle {}
.crop-box--active {}
```

### 4.2 属性顺序

```css
.element {
    /* 定位 */
    position: absolute;
    top: 0;
    left: 0;
    
    /* 盒模型 */
    width: 100px;
    height: 100px;
    margin: 10px;
    padding: 10px;
    
    /* 视觉 */
    background: #000;
    border: 1px solid #fff;
    
    /* 动画 */
    transition: transform 0.3s ease;
    transform: rotate(90deg);
}
```

### 4.3 响应式设计

```css
/* 移动端优先 */
.container {
    padding: 10px;
}

/* 平板及以上 */
@media (min-width: 768px) {
    .container {
        padding: 20px;
    }
}

/* 桌面端 */
@media (min-width: 1024px) {
    .container {
        padding: 30px;
    }
}
```

## 5. WebSocket 通信规范

### 5.1 消息格式

```javascript
// 所有消息使用 JSON 格式
const message = {
    type: 'control',
    displayId: 'abc123',
    action: 'rotate',
    value: 90
};

ws.send(JSON.stringify(message));
```

### 5.2 消息处理

```javascript
// 推荐: 使用 switch 处理不同类型
ws.onmessage = function(event) {
    try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'displayList':
                handleDisplayList(data.list);
                break;
            case 'displayState':
                handleDisplayState(data);
                break;
            default:
                console.warn('未知消息类型:', data.type);
        }
    } catch (e) {
        console.error('解析消息失败:', e);
    }
};
```

### 5.3 连接管理

```javascript
// 推荐: 自动重连
function connectWebSocket() {
    const ws = new WebSocket(url);
    
    ws.onclose = function() {
        setTimeout(connectWebSocket, 3000);
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket错误:', error);
    };
}
```

## 6. 代码组织

### 6.1 函数分组

```javascript
// 推荐: 按功能分组

// === 状态管理 ===
let currentFit = 'contain';
let currentRotation = 0;

// === DOM 元素 ===
const mediaImage = document.getElementById('mediaImage');
const mediaVideo = document.getElementById('mediaVideo');

// === 核心功能 ===
function applyFit(fit) { /* ... */ }
function applyCrop() { /* ... */ }

// === 事件处理 ===
function onCropMouseDown(e) { /* ... */ }
function onCropMouseMove(e) { /* ... */ }

// === 初始化 ===
function init() { /* ... */ }
init();
```

### 6.2 避免全局污染

```javascript
// 推荐: 使用 IIFE 或模块
(function() {
    // 所有代码在此作用域内
    const privateVar = 'private';
    
    function privateFunc() {}
    
    // 暴露必要的全局变量
    window.publicAPI = {
        doSomething: privateFunc
    };
})();
```

## 7. 性能优化

### 7.1 DOM 操作

```javascript
// 推荐: 批量更新
const fragment = document.createDocumentFragment();
items.forEach(item => {
    const el = document.createElement('div');
    fragment.appendChild(el);
});
container.appendChild(fragment);

// 避免: 循环中直接操作 DOM
items.forEach(item => {
    container.appendChild(createElement(item)); // 不推荐
});
```

### 7.2 事件节流

```javascript
// 推荐: 节流高频事件
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateCropBox, 100);
});
```

### 7.3 内存管理

```javascript
// 推荐: 及时清理
ws.onclose = function() {
    displayClients.delete(displayId);
    // 清理相关资源
};

// 推荐: 移除事件监听
function destroy() {
    element.removeEventListener('click', handler);
    ws.close();
}
```

## 8. 注释规范

### 8.1 函数注释

```javascript
/**
 * 应用裁剪设置
 * 根据当前裁剪数据计算并应用媒体尺寸和位置
 */
function applyCrop() {
    // ...
}

/**
 * 发送控制指令到显示端
 * @param {string} action - 控制动作类型
 * @param {any} value - 控制值
 */
function sendControl(action, value) {
    // ...
}
```

### 8.2 复杂逻辑注释

```javascript
// 旋转90度或270度时，宽高互换
// "高度铺满"旋转后应执行"宽度铺满"效果
if (isRotated) {
    const displayHeight = containerWidth;
    const displayWidth = containerWidth * mediaRatio;
}
```

## 9. 安全规范

### 9.1 输入验证

```javascript
// 推荐: 验证外部输入
function handleControl(data) {
    const validActions = ['rotate', 'fit', 'crop', 'play', 'seek', 'volume'];
    if (!validActions.includes(data.action)) {
        console.warn('无效的控制动作:', data.action);
        return;
    }
    // ...
}
```

### 9.2 XSS 防护

```javascript
// 推荐: 使用 textContent 而非 innerHTML
fileNameDisplay.textContent = data.fileName;

// 避免: 直接插入未转义的内容
element.innerHTML = `<div>${userInput}</div>`; // 危险
```

### 9.3 敏感信息

```javascript
// 不记录敏感信息
console.log('用户连接:', clientIP); // 可接受
console.log('密码:', password); // 禁止
```

## 10. 测试规范

### 10.1 手动测试清单

- [ ] 显示端连接/断开
- [ ] 控制端选择显示端
- [ ] 文件上传
- [ ] URL 发送
- [ ] 画面填充模式切换
- [ ] 旋转功能
- [ ] 裁剪功能
- [ ] 视频播放控制
- [ ] 多显示端场景

### 10.2 边界条件测试

```javascript
// 测试边界值
cropData.x = Math.max(0, Math.min(100 - cropData.width, value));
cropData.width = Math.max(10, Math.min(100, value));
```
